'use strict';

/*
 * Cart and Wishlist, both scoped to the logged-in user. These are the setup
 * steps for the checkout chain: add books to a cart, then create an order
 * from that cart.
 *
 *   GET    /api/cart                 -> current user's cart with totals
 *   POST   /api/cart/items           -> add a book (or increase quantity)
 *   PATCH  /api/cart/items/:bookId   -> set quantity for a book
 *   DELETE /api/cart/items/:bookId   -> remove a book from the cart
 *   DELETE /api/cart                 -> empty the cart
 *
 *   GET    /api/wishlist             -> current user's wishlist
 *   POST   /api/wishlist/items       -> add a book to the wishlist
 *   DELETE /api/wishlist/items/:bookId -> remove a book from the wishlist
 */

const store = require('../store');
const { validate } = require('../lib/validate');
const {
  NotFoundError, ValidationError, ConflictError, BadRequestError,
} = require('../lib/errors');
const { requireAuth } = require('../middleware/authenticate');

function activeBook(bookId) {
  const book = store.getState().books.find((b) => b.id === Number(bookId));
  if (!book || book.deleted) return null;
  return book;
}

function getCart(userId) {
  const carts = store.getState().carts;
  if (!carts[userId]) carts[userId] = { items: [] };
  return carts[userId];
}

function cartView(userId) {
  const cart = getCart(userId);
  const items = cart.items.map((it) => {
    const book = store.getState().books.find((b) => b.id === it.bookId);
    const price = book ? book.price : 0;
    return {
      bookId: it.bookId,
      title: book ? book.title : null,
      unitPrice: price,
      format: book ? book.format : null,
      quantity: it.quantity,
      lineTotal: Number((price * it.quantity).toFixed(2)),
    };
  });
  const subtotal = Number(items.reduce((sum, it) => sum + it.lineTotal, 0).toFixed(2));
  const itemCount = items.reduce((sum, it) => sum + it.quantity, 0);
  return { userId, items, itemCount, subtotal, currency: 'INR' };
}

function getWishlist(userId) {
  const wishlists = store.getState().wishlists;
  if (!wishlists[userId]) wishlists[userId] = [];
  return wishlists[userId];
}

function registerCartRoutes(router) {
  // ----- Cart -----
  router.get('/api/cart', requireAuth, (ctx) => {
    ctx.json(200, cartView(ctx.user.id));
  });

  router.post('/api/cart/items', requireAuth, (ctx) => {
    validate(ctx.body, {
      bookId: { type: 'integer', required: true, min: 1 },
      quantity: { type: 'integer', min: 1, max: 100 },
    });
    const book = activeBook(ctx.body.bookId);
    if (!book) {
      throw new ValidationError([{ field: 'bookId', message: `bookId ${ctx.body.bookId} does not exist or is unavailable.`, code: 'relation' }]);
    }
    const quantity = ctx.body.quantity || 1;
    if (book.format === 'ebook' && quantity !== 1) {
      throw new ConflictError(`e-Books are limited to one copy per order.`);
    }
    if (book.stockCount < quantity) {
      throw new ConflictError(`Only ${book.stockCount} copies of "${book.title}" are in stock.`);
    }

    const cart = getCart(ctx.user.id);
    const existing = cart.items.find((it) => it.bookId === book.id);
    const requestedTotal = (existing ? existing.quantity : 0) + quantity;
    if (book.format === 'ebook' && existing) {
      throw new ConflictError(`Only one copy of the e-Book "${book.title}" can be added to an order.`);
    }
    if (requestedTotal > book.stockCount) {
      throw new ConflictError(`Only ${book.stockCount} copies of "${book.title}" are in stock. Your cart would contain ${requestedTotal}.`);
    }
    if (existing) existing.quantity = requestedTotal;
    else cart.items.push({ bookId: book.id, quantity });

    ctx.json(201, cartView(ctx.user.id));
  });

  router.patch('/api/cart/items/:bookId', requireAuth, (ctx) => {
    validate(ctx.body, { quantity: { type: 'integer', required: true, min: 1, max: 100 } });
    const cart = getCart(ctx.user.id);
    const item = cart.items.find((it) => it.bookId === Number(ctx.params.bookId));
    if (!item) throw new NotFoundError(`Book ${ctx.params.bookId} is not in your cart.`);
    const book = activeBook(ctx.params.bookId);
    if (!book) {
      throw new ConflictError(`Book ${ctx.params.bookId} is no longer available.`);
    }
    if (book.format === 'ebook' && ctx.body.quantity !== 1) {
      throw new ConflictError('e-Books are limited to one copy per order.');
    }
    if (ctx.body.quantity > book.stockCount) {
      throw new ConflictError(`Only ${book.stockCount} copies of "${book.title}" are in stock.`);
    }
    item.quantity = ctx.body.quantity;
    ctx.json(200, cartView(ctx.user.id));
  });

  router.delete('/api/cart/items/:bookId', requireAuth, (ctx) => {
    const cart = getCart(ctx.user.id);
    const idx = cart.items.findIndex((it) => it.bookId === Number(ctx.params.bookId));
    if (idx === -1) throw new NotFoundError(`Book ${ctx.params.bookId} is not in your cart.`);
    cart.items.splice(idx, 1);
    ctx.noContent();
  });

  router.delete('/api/cart', requireAuth, (ctx) => {
    getCart(ctx.user.id).items = [];
    ctx.noContent();
  });

  // ----- Wishlist -----
  router.get('/api/wishlist', requireAuth, (ctx) => {
    const ids = getWishlist(ctx.user.id);
    const items = ids
      .map((id) => store.getState().books.find((b) => b.id === id))
      .filter(Boolean)
      .map((b) => ({ bookId: b.id, title: b.title, price: b.price }));
    ctx.json(200, { userId: ctx.user.id, items });
  });

  router.post('/api/wishlist/items', requireAuth, (ctx) => {
    validate(ctx.body, { bookId: { type: 'integer', required: true, min: 1 } });
    const book = activeBook(ctx.body.bookId);
    if (!book) {
      throw new ValidationError([{ field: 'bookId', message: `bookId ${ctx.body.bookId} does not exist or is unavailable.`, code: 'relation' }]);
    }
    const list = getWishlist(ctx.user.id);
    if (list.includes(book.id)) {
      throw new ConflictError('This book is already in your wishlist.');
    }
    list.push(book.id);
    ctx.json(201, { userId: ctx.user.id, bookId: book.id, added: true });
  });

  router.delete('/api/wishlist/items/:bookId', requireAuth, (ctx) => {
    const list = getWishlist(ctx.user.id);
    const idx = list.indexOf(Number(ctx.params.bookId));
    if (idx === -1) throw new NotFoundError(`Book ${ctx.params.bookId} is not in your wishlist.`);
    list.splice(idx, 1);
    ctx.noContent();
  });
}

module.exports = { registerCartRoutes, getCart, cartView };
