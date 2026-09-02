'use strict';

/*
 * Orders. This is the end of the main chain:
 *   login -> add items to cart -> create order (checkout) -> read order back.
 *
 *   GET  /api/orders            -> list the current user's orders (admin: all)
 *   GET  /api/orders/:id        -> get one order (owner or admin)
 *   POST /api/orders            -> create an order from the current cart
 *   PATCH /api/orders/:id       -> admin: advance status / payment status
 *   POST /api/orders/:id/cancel -> cancel an order that is still "pending"
 *
 * Robustness rules enforced here (previously missing):
 *   - Stock is re-validated and DECREMENTED atomically at checkout.
 *   - Cancelling a pending order RESTORES stock exactly once (idempotent).
 *   - Payment method is captured and stored, with method-specific validation.
 *   - Physical vs digital (e-Book) fulfilment is distinguished.
 *   - A customer-facing orderNumber is issued (the numeric id stays internal).
 *
 * Idempotency: POST /api/orders accepts an optional "Idempotency-Key" header.
 * Reusing the same key returns the SAME order instead of creating a duplicate.
 */

const crypto = require('crypto');
const store = require('../store');
const { validate } = require('../lib/validate');
const { applyQuery } = require('../lib/query');
const {
  NotFoundError, ForbiddenError, ConflictError, ValidationError,
} = require('../lib/errors');
const { requireAuth } = require('../middleware/authenticate');
const { requireRole } = require('../middleware/authorize');
const { getCart, cartView } = require('./cart.routes');

// Remember idempotency keys we have already processed -> orderId.
let idempotencyKeys = new Map();
function resetIdempotency() { idempotencyKeys = new Map(); }

function orders() { return store.getState().orders; }
function books() { return store.getState().books; }
function findBook(id) { return books().find((b) => b.id === Number(id)); }

const ORDER_STATUSES = ['pending', 'paid', 'packed', 'shipped', 'completed', 'delivered', 'cancelled'];
const PAYMENT_STATUSES = ['pending', 'authorized', 'paid', 'failed', 'refunded', 'cash_on_delivery'];
const PAYMENT_METHODS = ['cod', 'card', 'upi'];

// A short, human-friendly, collision-checked order number: TBS-YYYYMMDD-XXXXX.
function makeOrderNumber() {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  const existing = new Set(orders().map((o) => o.orderNumber));
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const rand = crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 5);
    const candidate = `TBS-${ymd}-${rand}`;
    if (!existing.has(candidate)) return candidate;
  }
  // Extremely unlikely fallback that is still unique.
  return `TBS-${ymd}-${Date.now().toString(36).toUpperCase()}`;
}

// Look at the books in the cart and decide how the order is fulfilled.
function classifyFulfilment(items) {
  let hasPhysical = false;
  let hasDigital = false;
  for (const it of items) {
    const book = findBook(it.bookId);
    if (!book) continue;
    if (book.format === 'ebook') hasDigital = true;
    else hasPhysical = true;
  }
  if (hasPhysical && hasDigital) return 'mixed';
  if (hasDigital && !hasPhysical) return 'digital';
  return 'physical';
}

const UPI_RE = /^[a-zA-Z0-9.\-_]{2,}@[a-zA-Z]{2,}$/;

// Validate the checkout payload against the cart's fulfilment type. Returns a
// normalized payment/shipping summary or throws a 422 with field details.
function buildCheckoutDetails(body, fulfilment) {
  const b = body && typeof body === 'object' ? body : {};
  const details = [];
  const needsPhysical = fulfilment === 'physical' || fulfilment === 'mixed';
  const hasDigital = fulfilment === 'digital' || fulfilment === 'mixed';
  const digitalOnly = fulfilment === 'digital';

  // ---- Customer name (always required, must contain a letter) ----
  const name = typeof b.customerName === 'string' ? b.customerName.trim() : '';
  if (!name) {
    details.push({ field: 'customerName', message: 'Full name is required.', code: 'required' });
  } else if (name.length < 2 || name.length > 80) {
    details.push({ field: 'customerName', message: 'Full name must be 2 to 80 characters.', code: 'length' });
  } else if (!/[A-Za-z\u00C0-\u024F\u0900-\u097F]/.test(name)) {
    details.push({ field: 'customerName', message: 'Full name must contain at least one letter.', code: 'format' });
  }

  // ---- Shipping (physical) vs delivery email (digital) ----
  let shippingAddress = null;
  let deliveryEmail = null;
  if (needsPhysical) {
    const addr = typeof b.shippingAddress === 'string' ? b.shippingAddress.trim() : '';
    if (!addr) {
      details.push({ field: 'shippingAddress', message: 'A shipping address is required for physical books.', code: 'required' });
    } else if (addr.length < 8 || addr.length > 500) {
      details.push({ field: 'shippingAddress', message: 'Shipping address must be 8 to 500 characters.', code: 'length' });
    } else {
      shippingAddress = addr;
    }
  }
  if (hasDigital) {
    const email = typeof b.deliveryEmail === 'string' ? b.deliveryEmail.trim() : '';
    if (!email) {
      details.push({ field: 'deliveryEmail', message: 'A delivery email is required whenever the order contains an e-Book.', code: 'required' });
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      details.push({ field: 'deliveryEmail', message: 'Enter a valid delivery email address.', code: 'email' });
    } else {
      deliveryEmail = email;
    }
  }

  // ---- Payment method (defaults to COD) and method-specific validation ----
  const method = b.paymentMethod === undefined ? 'cod' : b.paymentMethod;
  if (!PAYMENT_METHODS.includes(method)) {
    details.push({ field: 'paymentMethod', message: `paymentMethod must be one of: ${PAYMENT_METHODS.join(', ')}.`, code: 'enum' });
  }

  let paymentStatus = 'pending';
  let paymentReference = null;
  let paymentLast4 = null;

  if (method === 'cod') {
    if (hasDigital) {
      details.push({ field: 'paymentMethod', message: 'Cash on delivery is not available when an order contains an e-Book.', code: 'unsupported' });
    }
    paymentStatus = 'cash_on_delivery';
  } else if (method === 'card') {
    const card = b.card && typeof b.card === 'object' ? b.card : {};
    const cardName = typeof card.name === 'string' ? card.name.trim() : '';
    const number = typeof card.number === 'string' ? card.number.replace(/[\s-]/g, '') : '';
    const cvv = typeof card.cvv === 'string' ? card.cvv.trim() : String(card.cvv || '');
    const expMonth = Number(card.expiryMonth);
    const expYear = Number(card.expiryYear);
    if (!cardName || cardName.length < 2) details.push({ field: 'card.name', message: 'Name on card is required.', code: 'required' });
    if (!/^\d{12,19}$/.test(number)) details.push({ field: 'card.number', message: 'Card number must be 12 to 19 digits.', code: 'format' });
    if (!Number.isInteger(expMonth) || expMonth < 1 || expMonth > 12) details.push({ field: 'card.expiryMonth', message: 'Expiry month must be 1 to 12.', code: 'range' });
    if (!Number.isInteger(expYear) || expYear < 2000 || expYear > 2100) details.push({ field: 'card.expiryYear', message: 'Expiry year is invalid.', code: 'range' });
    if (!/^\d{3,4}$/.test(cvv)) details.push({ field: 'card.cvv', message: 'CVV must be 3 or 4 digits.', code: 'format' });
    // Not expired (only check when month/year look valid).
    if (Number.isInteger(expMonth) && Number.isInteger(expYear) && expMonth >= 1 && expMonth <= 12) {
      const now = new Date();
      const endOfExpiry = new Date(Date.UTC(expYear, expMonth, 0, 23, 59, 59));
      if (endOfExpiry < now) details.push({ field: 'card.expiryYear', message: 'This card has expired.', code: 'range' });
    }
    if (number) paymentLast4 = number.slice(-4);
    paymentStatus = 'paid';
    paymentReference = 'CARD-DEMO-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  } else if (method === 'upi') {
    const upiId = typeof b.upiId === 'string' ? b.upiId.trim() : '';
    if (!UPI_RE.test(upiId)) {
      details.push({ field: 'upiId', message: 'Enter a valid UPI ID, for example name@bank.', code: 'format' });
    }
    paymentStatus = 'paid';
    paymentReference = 'UPI-DEMO-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  }

  const giftWrap = needsPhysical ? b.giftWrap === true : false;

  if (details.length > 0) throw new ValidationError(details);

  return {
    customerName: name,
    shippingAddress: needsPhysical ? shippingAddress : 'Digital delivery (no shipping)',
    deliveryEmail,
    paymentMethod: method,
    paymentStatus,
    paymentReference,
    paymentLast4,
    giftWrap,
    fulfilmentType: fulfilment,
  };
}

// Re-check current stock for every line and decrement it atomically. Throws a
// 409 (with details) if anything is short, having changed nothing.
function reserveStockOrThrow(items) {
  const shortages = [];
  for (const it of items) {
    const book = findBook(it.bookId);
    if (!book || book.deleted) {
      shortages.push({ field: `book.${it.bookId}`, message: `"${it.title || 'A book'}" is no longer available.`, code: 'unavailable' });
    } else if (book.stockCount < it.quantity) {
      shortages.push({ field: `book.${it.bookId}`, message: `Only ${book.stockCount} copy(ies) of "${book.title}" remain (you requested ${it.quantity}).`, code: 'insufficient_stock', available: book.stockCount });
    }
  }
  if (shortages.length > 0) {
    throw new ConflictError('Some items are no longer available in the requested quantity. Your cart needs updating.', shortages);
  }
  // All good: commit the decrements.
  for (const it of items) {
    const book = findBook(it.bookId);
    book.stockCount -= it.quantity;
    book.inStock = book.stockCount > 0;
    book.updatedAt = new Date().toISOString();
  }
}

// Put stock back for a cancelled/refunded order, but only once.
function releaseStock(order) {
  if (order.stockReleased) return;
  for (const it of order.items) {
    const book = findBook(it.bookId);
    if (book) {
      book.stockCount += it.quantity;
      book.inStock = book.stockCount > 0;
      book.updatedAt = new Date().toISOString();
    }
  }
  order.stockReleased = true;
}

function registerOrderRoutes(router) {
  // LIST (own orders; admin sees all)
  router.get('/api/orders', requireAuth, (ctx) => {
    const all = orders();
    let visible;
    const scope = ctx.url.searchParams.get('scope');
    if (ctx.user.role === 'admin' && scope === 'mine') visible = all.filter((o) => o.userId === ctx.user.id);
    else if (ctx.user.role === 'admin' && scope === 'customers') visible = all.filter((o) => o.userId !== ctx.user.id);
    else visible = ctx.user.role === 'admin' ? all : all.filter((o) => o.userId === ctx.user.id);
    const result = applyQuery(visible, ctx.url.searchParams, { searchableFields: ['status', 'orderNumber'] });
    ctx.json(200, result);
  });

  // GET ONE (owner or admin)
  router.get('/api/orders/:id', requireAuth, (ctx) => {
    const order = orders().find((o) => o.id === Number(ctx.params.id));
    if (!order) throw new NotFoundError(`Order ${ctx.params.id} was not found.`);
    if (ctx.user.role !== 'admin' && order.userId !== ctx.user.id) {
      throw new ForbiddenError('You may only view your own orders.');
    }
    ctx.json(200, order);
  });

  // CREATE from cart (with optional idempotency key)
  router.post('/api/orders', requireAuth, (ctx) => {
    const idemKey = ctx.req.headers['idempotency-key'];

    if (idemKey) {
      const existingId = idempotencyKeys.get(`${ctx.user.id}:${idemKey}`);
      if (existingId) {
        const existing = orders().find((o) => o.id === existingId);
        if (existing) {
          ctx.json(200, existing, { 'Idempotency-Replayed': 'true' });
          return;
        }
      }
    }

    const view = cartView(ctx.user.id);
    if (view.items.length === 0) {
      throw new ConflictError('Your cart is empty. Add items before checking out.');
    }

    const fulfilment = classifyFulfilment(view.items);
    const checkout = buildCheckoutDetails(ctx.body, fulfilment);

    // Re-validate and decrement stock atomically (throws 409 if short).
    reserveStockOrThrow(view.items);

    const id = store.nextId('orders');
    const now = new Date().toISOString();
    const order = {
      id,
      uuid: crypto.randomUUID(),
      orderNumber: makeOrderNumber(),
      userId: ctx.user.id,
      items: view.items.map((it) => ({
        bookId: it.bookId,
        title: it.title,
        unitPrice: it.unitPrice,
        quantity: it.quantity,
        lineTotal: it.lineTotal,
      })),
      itemCount: view.itemCount,
      subtotal: view.subtotal,
      currency: view.currency,
      status: checkout.fulfilmentType === 'digital' ? 'completed' : 'pending',
      customerName: checkout.customerName,
      shippingAddress: checkout.shippingAddress,
      deliveryEmail: checkout.deliveryEmail,
      giftWrap: checkout.giftWrap,
      fulfilmentType: checkout.fulfilmentType,
      paymentMethod: checkout.paymentMethod,
      paymentStatus: checkout.paymentStatus,
      paymentReference: checkout.paymentReference,
      paymentLast4: checkout.paymentLast4,
      stockReleased: false,
      createdAt: now,
      updatedAt: now,
    };
    orders().push(order);

    // Empty the cart after a successful checkout.
    getCart(ctx.user.id).items = [];

    if (idemKey) {
      idempotencyKeys.set(`${ctx.user.id}:${idemKey}`, id);
    }

    ctx.json(201, order, { Location: `/api/orders/${id}` });
  });

  // ADMIN: advance an order's lifecycle (status / paymentStatus).
  router.patch('/api/orders/:id', requireAuth, requireRole('admin'), (ctx) => {
    const order = orders().find((o) => o.id === Number(ctx.params.id));
    if (!order) throw new NotFoundError(`Order ${ctx.params.id} was not found.`);
    validate(ctx.body, {
      status: { type: 'string', enum: ORDER_STATUSES },
      paymentStatus: { type: 'string', enum: PAYMENT_STATUSES },
    }, { partial: true });

    if (ctx.body.status !== undefined) {
      if (ctx.body.status === 'cancelled') releaseStock(order);
      order.status = ctx.body.status;
    }
    if (ctx.body.paymentStatus !== undefined) {
      if (ctx.body.paymentStatus === 'refunded') releaseStock(order);
      order.paymentStatus = ctx.body.paymentStatus;
    }
    order.updatedAt = new Date().toISOString();
    ctx.json(200, order);
  });

  // CANCEL (owner or admin). Pending physical/mixed orders and completed digital orders may be cancelled.
  router.post('/api/orders/:id/cancel', requireAuth, (ctx) => {
    const order = orders().find((o) => o.id === Number(ctx.params.id));
    if (!order) throw new NotFoundError(`Order ${ctx.params.id} was not found.`);
    if (ctx.user.role !== 'admin' && order.userId !== ctx.user.id) {
      throw new ForbiddenError('You may only cancel your own orders.');
    }
    const cancellable = order.status === 'pending' || (order.fulfilmentType === 'digital' && order.status === 'completed');
    if (!cancellable) {
      throw new ConflictError(`Order ${order.id} is "${order.status}" and can no longer be cancelled.`);
    }
    releaseStock(order);
    order.status = 'cancelled';
    if (order.paymentStatus === 'paid') order.paymentStatus = 'refunded';
    order.updatedAt = new Date().toISOString();
    ctx.json(200, order);
  });
}

module.exports = { registerOrderRoutes, resetIdempotency };
