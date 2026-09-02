'use strict';

const { URL } = require('url');
const { ApiError } = require('../lib/errors');
const { getBookDetails, listCategories, searchAllBooks, searchBooks } = require('./catalog');

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function comparableTitle(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function resolveBookReference(message, bookContext) {
  const books = Array.isArray(bookContext) ? bookContext : [];
  if (!books.length) return null;
  const text = comparableTitle(message);
  const exactTitle = books
    .filter((book) => {
      const title = comparableTitle(book && book.title);
      return title && text.includes(title);
    })
    .sort((a, b) => String(b.title).length - String(a.title).length)[0];
  if (exactTitle) return exactTitle;

  const ordinalWords = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
  for (const [word, position] of Object.entries(ordinalWords)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(message) && books[position - 1]) return books[position - 1];
  }
  const numbered = String(message || '').match(/\b(?:option|book|number)\s*(\d{1,2})(?:\s*(?:\\?\.|\)))?/i)
    || String(message || '').match(/(?:^|:\s*)(\d{1,2})\s*(?:\\?\.|\))/i);
  if (numbered) {
    const position = Number(numbered[1]);
    if (position >= 1 && position <= books.length) return books[position - 1];
  }
  if (/\b(?:this|that|it)\b/i.test(message) && books.length === 1) return books[0];
  if (books.length === 1 && /\b(?:item|book)\b/i.test(message)) return books[0];
  return null;
}

function asksBulkAdd(message) {
  const text = cleanText(message);
  return /\b(?:add|put)\b/i.test(text)
    && /\b(?:all|every)\b/i.test(text)
    && /\bbooks?\b/i.test(text)
    && /\bcart\b/i.test(text);
}

function asksCheckout(message) {
  return /\b(?:go|proceed|continue|start|open|take me)\b.{0,50}\bcheckout\b/i.test(cleanText(message))
    || /^\s*checkout\s*$/i.test(String(message || ''));
}

function asksBestBook(message) {
  return /\b(?:which|what)\b.{0,40}\bbest\b/i.test(cleanText(message))
    || /\bbest\s+(?:book|one|choice|option)\b/i.test(cleanText(message));
}

function asksMoreBooks(message) {
  return /\b(?:more|other|additional)\s+books?\b/i.test(cleanText(message));
}

function asksCartRemoval(message) {
  const text = cleanText(message);
  return /\b(?:remove|delete)\b/i.test(text) && /\b(?:cart|item|book)\b/i.test(text);
}

function explicitCatalogTopic(message) {
  const text = cleanText(message);
  if (/\bplaywright\b/i.test(text)) {
    return { query: /\bplaywright\s+book\b(?!s)/i.test(text) ? 'Playwright book' : 'Playwright' };
  }
  if (/\bci\s*[/&-]?\s*cd\b|\bcontinuous\s+integration\b/i.test(text)) return { category: 'CI/CD' };
  const match = text.match(/\brelated\s+to\s+(.+?)(?:\s+(?:in|to)\s+(?:the\s+)?cart|\s+without\s+duplicates?|\s+one\s+cop(?:y|ies)\s+each|$)/i);
  if (!match) return {};
  const query = cleanText(match[1]).replace(/\bbooks?\b/gi, ' ').replace(/\s+/g, ' ').trim();
  return query ? { query } : {};
}

function commonContextCategory(bookContext) {
  const categories = [...new Set((Array.isArray(bookContext) ? bookContext : [])
    .map((book) => cleanText(book && book.category))
    .filter(Boolean))];
  return categories.length === 1 ? categories[0] : null;
}

function explicitQuantity(message) {
  const text = cleanText(message);
  const patterns = [
    /\b(?:quantity|qty|copies?)\s*(?:of|:|=|x)?\s*(\d+)\b/i,
    /\b(?:add|buy|get|put)\s+(\d+)\s*(?:copies?|items?|x)?\b/i,
    /\bx\s*(\d+)\b/i,
    /\b(\d+)\s+copies?\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const quantity = Number(match[1]);
    if (Number.isSafeInteger(quantity)) return quantity;
  }
  return null;
}

function asksForAvailability(message) {
  return /\b(?:in[ -]?stock|available|availability)\b/i.test(cleanText(message));
}

function cleanAvailabilityQuery(value) {
  const cleaned = cleanText(value)
    .replace(/\b(?:what|which|show|list|give|tell|me|all|the|currently|is|are|books?|titles?|in[ -]?stock|available|availability)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || null;
}

function normalizeToolArguments(name, args, userMessage, options = {}) {
  const safe = args && typeof args === 'object' && !Array.isArray(args) ? Object.assign({}, args) : {};
  if (name === 'search_books') {
    const explicitTopic = explicitCatalogTopic(userMessage);
    const priorCategory = commonContextCategory(options.bookContext);
    if (explicitTopic.category) {
      safe.category = explicitTopic.category;
      delete safe.query;
    } else if (explicitTopic.query && /\bplaywright\b/i.test(explicitTopic.query)) {
      safe.query = explicitTopic.query;
      delete safe.category;
    } else if ((asksBestBook(userMessage) || asksMoreBooks(userMessage)) && priorCategory) {
      safe.category = priorCategory;
      delete safe.query;
    }
    if (asksBestBook(userMessage)) {
      safe.inStock = true;
      safe.sort = 'averageRating';
      safe.order = 'desc';
    }
    if (asksForAvailability(userMessage)) {
      safe.inStock = true;
      const topicalQuery = cleanAvailabilityQuery(safe.query);
      if (topicalQuery) safe.query = topicalQuery;
      else delete safe.query;
      safe.limit = 10;
    } else {
      safe.limit = Math.max(1, Math.min(10, Number.parseInt(safe.limit, 10) || 5));
    }
  }
  if (name === 'add_matching_books_to_cart') {
    const topic = explicitCatalogTopic(userMessage);
    if (topic.category) {
      safe.category = topic.category;
      delete safe.query;
    } else if (topic.query) {
      safe.query = topic.query;
      delete safe.category;
    }
    safe.quantity = 1;
  }
  if (name === 'add_to_cart') {
    // Quantity is consequential. Never trust a quantity invented by a model:
    // use the customer's explicit number, otherwise add exactly one copy.
    safe.quantity = explicitQuantity(userMessage) ?? 1;
    const referencedBook = resolveBookReference(userMessage, options.bookContext);
    if (referencedBook) safe.bookId = referencedBook.id;
  }
  if (name === 'update_cart') {
    const requested = explicitQuantity(userMessage);
    if (requested !== null) safe.quantity = requested;
    else delete safe.quantity;
    const referencedBook = resolveBookReference(userMessage, options.bookContext);
    if (referencedBook) safe.bookId = referencedBook.id;
  }
  if (name === 'remove_from_cart') {
    const referencedBook = resolveBookReference(userMessage, options.bookContext);
    if (referencedBook) safe.bookId = referencedBook.id;
  }
  return safe;
}

function formatMoney(value, currency = 'INR') {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return `${currency || 'INR'} ${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function formatRating(book) {
  if (book.averageRating == null) return 'Not yet rated';
  const count = Number(book.reviewCount) || 0;
  return `${book.averageRating}/5 (${count} review${count === 1 ? '' : 's'})`;
}

function formatBookFormat(value) {
  return ({ paperback: 'Paperback', ebook: 'e-Book', hardcover: 'Hardcover' })[String(value || '').toLowerCase()]
    || value
    || 'Not listed';
}

function formatBooks(result, userMessage) {
  const books = result && Array.isArray(result.books) ? result.books : [];
  const total = Number(result && result.totalMatches) || books.length;
  if (!books.length) return 'I could not find a verified book matching that request. Try a title, author, category, format, or price range.';
  const availability = asksForAvailability(userMessage);
  const heading = total > books.length
    ? `Showing ${books.length} of ${total} verified ${availability ? 'books currently in stock' : 'matching books'}:`
    : `I found ${total} verified ${availability ? 'book' + (total === 1 ? '' : 's') + ' currently in stock' : 'matching book' + (total === 1 ? '' : 's')}:`;
  const details = books.map((book, index) => {
    const lines = [
      `**${index + 1}. ${book.title}**`,
      `Author: ${book.author || 'Not listed'}`,
      `Category: ${book.category || 'Not listed'}`,
      `Description: ${book.description || 'Not listed'}`,
      `Publisher: ${book.publisher || 'Not listed'}`,
      `ISBN: ${book.isbn || 'Not listed'}`,
      `Format: ${formatBookFormat(book.format)}`,
      `Language: ${book.language || 'Not listed'}`,
      `Pages: ${book.pages == null ? 'Not listed' : book.pages}`,
      `Published: ${book.publishedYear == null ? 'Not listed' : book.publishedYear}`,
      `Price: ${formatMoney(book.price, book.currency) || 'Not listed'}`,
      `Availability: ${book.inStock ? 'In stock' : 'Out of stock'}`,
      `Rating: ${formatRating(book)}`,
      `Tags: ${Array.isArray(book.tags) && book.tags.length ? book.tags.join(', ') : 'Not listed'}`,
    ];
    return lines.join('\n');
  });
  const followUp = total > books.length
    ? `\n\nThese are the first ${books.length} results, not a truncated total. Ask me to narrow them by category, price, format, author, or title.`
    : '';
  return `${heading}\n\n${details.join('\n\n')}${followUp}`;
}

function formatBestBook(result) {
  const books = result && Array.isArray(result.books) ? result.books : [];
  if (!books.length) return 'I could not find an in-stock verified book to recommend from those results.';
  const best = books[0];
  const basis = best.averageRating == null
    ? 'There are no customer ratings available, so this is the first in-stock verified match.'
    : `It has the highest available verified rating in these results: ${formatRating(best)}.`;
  return `My best verified choice is:\n\n${formatBooks({ books: [best], totalMatches: 1 }, '')}\n\nWhy: ${basis}`;
}

function formatCart(result, name, args) {
  const items = result && Array.isArray(result.items) ? result.items : [];
  const target = items.find((item) => item.bookId === Number(args.bookId));
  const cartSummary = `Cart total: ${formatMoney(result.subtotal, result.currency) || 'Not available'} (${Number(result.itemCount) || 0} item${Number(result.itemCount) === 1 ? '' : 's'})`;
  if (name === 'add_to_cart' && target) {
    return [
      `Added **${target.title}** to your cart.`,
      `Quantity added: ${args.quantity}`,
      `Quantity in cart: ${target.quantity}`,
      `Unit price: ${formatMoney(target.unitPrice, result.currency) || 'Not available'}`,
      cartSummary,
      'Next step: open your cart. You stay in control of checkout details and whether to buy; I will not submit an order or payment.',
    ].join('\n');
  }
  if (name === 'update_cart' && target) {
    return [`Updated **${target.title}**.`, `Quantity in cart: ${target.quantity}`, cartSummary].join('\n');
  }
  if (name === 'remove_from_cart') return [`Removed the book from your cart.`, cartSummary].join('\n');
  if (!items.length) return 'Your cart is empty.';
  return [
    'Your cart contains:',
    '',
    ...items.flatMap((item, index) => [
      `**${index + 1}. ${item.title}**`,
      `Quantity: ${item.quantity}`,
      `Unit price: ${formatMoney(item.unitPrice, result.currency) || 'Not available'}`,
      `Line total: ${formatMoney(item.lineTotal, result.currency) || 'Not available'}`,
      '',
    ]),
    cartSummary,
  ].join('\n').trim();
}

function formatBulkCart(result) {
  const added = Array.isArray(result && result.addedBooks) ? result.addedBooks : [];
  const existing = Array.isArray(result && result.alreadyPresentBooks) ? result.alreadyPresentBooks : [];
  const unavailable = Array.isArray(result && result.outOfStockBooks) ? result.outOfStockBooks : [];
  const failed = Array.isArray(result && result.failedBooks) ? result.failedBooks : [];
  const lines = [
    `I found ${Number(result && result.matchedCount) || 0} verified matching books.`,
    `Added ${added.length} in-stock book${added.length === 1 ? '' : 's'} to your cart, one copy each, without duplicates.`,
  ];
  if (added.length) lines.push(`Added: ${added.map((book) => `**${book.title}**`).join(', ')}`);
  if (existing.length) lines.push(`Already in your cart (not added again): ${existing.map((book) => `**${book.title}**`).join(', ')}`);
  if (unavailable.length) lines.push(`Out of stock (not added): ${unavailable.map((book) => `**${book.title}**`).join(', ')}`);
  if (failed.length) lines.push(`Could not add: ${failed.map((book) => `**${book.title}** (${book.reason})`).join(', ')}`);
  lines.push(`Cart total: ${formatMoney(result && result.subtotal, result && result.currency) || 'Not available'} (${Number(result && result.itemCount) || 0} item${Number(result && result.itemCount) === 1 ? '' : 's'})`);
  lines.push('Open your cart to review the books. You remain in control of checkout and payment.');
  return lines.join('\n\n');
}

function formatOrder(order) {
  if (!order) return 'The requested order was not found.';
  const lines = [
    `**Order ${order.orderNumber || '#' + order.id}**`,
    `Status: ${order.status || 'Not available'}`,
    `Payment: ${order.paymentStatus || 'Not available'}`,
    `Fulfilment: ${order.fulfilmentType || 'Not available'}`,
    `Items: ${Number(order.itemCount) || 0}`,
    `Total: ${formatMoney(order.subtotal, order.currency) || 'Not available'}`,
  ];
  if (order.createdAt) lines.push(`Created: ${order.createdAt}`);
  return lines.join('\n');
}

function searchMustContinueToAction(message) {
  const text = cleanText(message);
  return /\b(?:add|put)\b.{0,100}\bcart\b/i.test(text)
    || /\bremove\b.{0,100}\bcart\b/i.test(text)
    || /\bcancel\b.{0,100}\border\b/i.test(text);
}

function customerMessageFor(name, outcome, args, userMessage) {
  if (!outcome || outcome.ok !== true) {
    if (outcome && outcome.error && outcome.error.code === 'UNAUTHORIZED') {
      return 'Please sign in to use your cart. After signing in, ask me to add the book again; I will only add it to your cart and will not place the order or make a payment.';
    }
    const errorMessage = outcome && outcome.error && outcome.error.message;
    return errorMessage ? `I could not complete that request. ${errorMessage}` : 'I could not complete that request safely.';
  }
  if (name === 'search_books') {
    if (asksBestBook(userMessage)) return formatBestBook(outcome.result);
    if (!searchMustContinueToAction(userMessage)) return formatBooks(outcome.result, userMessage);
    const books = outcome.result && Array.isArray(outcome.result.books) ? outcome.result.books : [];
    const namedBook = requestedBookFromRows(books, userMessage);
    if (namedBook || books.length === 1) return null;
    const list = formatBooks(outcome.result, userMessage);
    return `${list}\n\nI have not changed your cart because more than one book matches. Tell me the exact title or option number you want to add.`;
  }
  if (name === 'get_book_details') {
    const books = outcome.result && Array.isArray(outcome.result.books) ? outcome.result.books : [];
    return searchMustContinueToAction(userMessage) ? null : formatBooks({ books, totalMatches: books.length }, userMessage);
  }
  if (name === 'list_categories') {
    const rows = outcome.result && Array.isArray(outcome.result.categories) ? outcome.result.categories : [];
    return rows.length
      ? `Available categories:\n\n${rows.map((row) => `* **${row.name}** (${row.bookCount} book${row.bookCount === 1 ? '' : 's'})`).join('\n')}`
      : 'No categories are currently available.';
  }
  if (['view_cart', 'add_to_cart', 'update_cart', 'remove_from_cart'].includes(name)) {
    if (name === 'view_cart' && asksCheckout(userMessage)) {
      const cart = formatCart(outcome.result, name, args);
      if (!outcome.result || !Array.isArray(outcome.result.items) || !outcome.result.items.length) {
        return `${cart}\n\nAdd at least one in-stock book before continuing to checkout.`;
      }
      return `Your cart is ready. I’ll open the checkout page, where you can review the order, fill in your information, choose payment, and decide whether to place the order. I will not submit anything for you.\n\n${cart}`;
    }
    return formatCart(outcome.result, name, args);
  }
  if (name === 'add_matching_books_to_cart') return formatBulkCart(outcome.result);
  if (name === 'list_orders') {
    const orders = outcome.result && Array.isArray(outcome.result.orders) ? outcome.result.orders : [];
    const total = Number(outcome.result && outcome.result.total) || orders.length;
    if (!orders.length) return 'You do not have any orders yet.';
    const heading = total > orders.length ? `Showing ${orders.length} of your ${total} orders:` : `You have ${total} order${total === 1 ? '' : 's'}:`;
    return `${heading}\n\n${orders.map(formatOrder).join('\n\n')}`;
  }
  if (name === 'get_order') return formatOrder(outcome.result);
  if (name === 'cancel_order') return `Order cancellation completed.\n\n${formatOrder(outcome.result)}`;
  return null;
}

function requestedBookFromRows(books, userMessage) {
  const text = comparableTitle(userMessage);
  return (Array.isArray(books) ? books : [])
    .filter((book) => {
      const title = comparableTitle(book && book.title);
      return title && text.includes(title);
    })
    .sort((a, b) => String(b.title).length - String(a.title).length)[0] || null;
}

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'search_books',
      description: 'Search the live bookstore catalog. Use before naming, recommending, pricing, or checking availability of books. Supports typo-tolerant relevance and verified filters. The catalog does not have a difficulty-level field.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural-language title, topic, keyword, ISBN, author, or category query.' },
          title: { type: 'string' },
          author: { type: 'string' },
          category: { type: 'string' },
          minPrice: { type: 'number' },
          maxPrice: { type: 'number' },
          inStock: { type: 'boolean' },
          format: { type: 'string', enum: ['paperback', 'ebook', 'hardcover'] },
          sort: { type: 'string', enum: ['title', 'price', 'publishedYear', 'averageRating'] },
          order: { type: 'string', enum: ['asc', 'desc'] },
          limit: { type: 'integer', minimum: 1, maximum: 10 },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_book_details',
      description: 'Get verified customer-safe details for up to 10 book IDs from the live catalog.',
      parameters: {
        type: 'object',
        required: ['bookIds'],
        properties: { bookIds: { type: 'array', items: { type: 'integer' }, maxItems: 10 } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_categories',
      description: 'List the real categories currently available in the bookstore.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'view_cart',
      description: 'View the authenticated customer’s current cart and verified totals. Requires sign-in.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_to_cart',
      description: 'Add a verified book ID to the authenticated customer’s cart. Use only after the customer clearly asks to add it. Requires sign-in.',
      parameters: {
        type: 'object', required: ['bookId'],
        properties: { bookId: { type: 'integer' }, quantity: { type: 'integer', minimum: 1, maximum: 100 } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_matching_books_to_cart',
      description: 'Add every in-stock book matching one explicit topic or category to the authenticated customer’s cart, one copy each. Existing cart items are not duplicated and out-of-stock matches are reported. Use only when the customer clearly asks to add all/every matching book. This never checks out, creates an order, or makes a payment.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          category: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_cart',
      description: 'Set the quantity of a book already in the authenticated customer’s cart. Requires sign-in.',
      parameters: {
        type: 'object', required: ['bookId', 'quantity'],
        properties: { bookId: { type: 'integer' }, quantity: { type: 'integer', minimum: 1, maximum: 100 } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_from_cart',
      description: 'Remove one book from the authenticated customer’s cart. Requires sign-in.',
      parameters: { type: 'object', required: ['bookId'], properties: { bookId: { type: 'integer' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_orders',
      description: 'List the authenticated customer’s own orders. Requires sign-in and never returns other customers’ orders.',
      parameters: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 10 } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_order',
      description: 'Get one of the authenticated customer’s own orders by internal numeric ID. Ownership is enforced by the application.',
      parameters: { type: 'object', required: ['orderId'], properties: { orderId: { type: 'integer' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_order',
      description: 'Cancel an eligible order owned by the authenticated customer. Use only after the customer clearly asks to cancel it. Ownership and status rules are enforced by the application.',
      parameters: { type: 'object', required: ['orderId'], properties: { orderId: { type: 'integer' } } },
    },
  },
];

function sanitizeCart(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  return {
    items: Array.isArray(payload.items) ? payload.items : [],
    itemCount: payload.itemCount,
    subtotal: payload.subtotal,
    currency: payload.currency,
  };
}

function sanitizeOrder(order) {
  if (!order || typeof order !== 'object') return order;
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    fulfilmentType: order.fulfilmentType,
    items: order.items,
    itemCount: order.itemCount,
    subtotal: order.subtotal,
    currency: order.currency,
    createdAt: order.createdAt,
  };
}

async function callInternalApi(router, requestCtx, method, path, body) {
  const url = new URL(path, 'http://internal.local');
  const matched = router.match(method, url.pathname);
  if (!matched || !matched.handlers) throw new ApiError(404, 'NOT_FOUND', 'The requested application operation is unavailable.');
  let captured = null;
  const ctx = {
    req: requestCtx.req,
    res: { writableEnded: false },
    url,
    query: url.searchParams,
    body: body || {},
    params: matched.params,
    user: null,
    tokenPayload: null,
    json(status, payload) { captured = { status, payload }; },
    noContent() { captured = { status: 204, payload: null }; },
  };
  for (const handler of matched.handlers) {
    // eslint-disable-next-line no-await-in-loop
    await handler(ctx);
    if (captured) break;
  }
  if (!captured) throw new ApiError(500, 'NO_RESPONSE', 'The application operation did not return a result.');
  return captured;
}

function toolError(error) {
  if (error instanceof ApiError) {
    return { ok: false, error: { code: error.code, message: error.message, details: error.details || [] } };
  }
  return { ok: false, error: { code: 'TOOL_ERROR', message: 'The application could not complete that operation.' } };
}

function createToolExecutor(router, requestCtx, options = {}) {
  const userMessage = cleanText(options.userMessage);
  const bookContext = Array.isArray(options.bookContext) ? options.bookContext : [];
  async function executeTool(name, args) {
    const safeArgs = normalizeToolArguments(name, args, userMessage, { bookContext });
    try {
      let outcome;
      if (name === 'search_books') {
        outcome = { ok: true, result: searchBooks(safeArgs) };
        const rows = outcome.result && Array.isArray(outcome.result.books) ? outcome.result.books : [];
        bookContext.splice(0, bookContext.length, ...rows.map((book) => Object.assign({}, book)));
      }
      if (name === 'get_book_details') {
        outcome = { ok: true, result: getBookDetails(safeArgs.bookIds) };
        const rows = outcome.result && Array.isArray(outcome.result.books) ? outcome.result.books : [];
        bookContext.splice(0, bookContext.length, ...rows.map((book) => Object.assign({}, book)));
      }
      if (name === 'list_categories') outcome = { ok: true, result: listCategories() };
      if (outcome) {
        const customerMessage = customerMessageFor(name, outcome, safeArgs, userMessage);
        return customerMessage ? Object.assign(outcome, { customerMessage }) : outcome;
      }

      let response;
      if (name === 'view_cart') {
        response = await callInternalApi(router, requestCtx, 'GET', '/api/cart', {});
        outcome = { ok: true, result: sanitizeCart(response.payload) };
        const rows = outcome.result && Array.isArray(outcome.result.items) ? outcome.result.items : [];
        bookContext.splice(0, bookContext.length, ...rows.map((item) => ({ id: item.bookId, title: item.title })));
      }
      if (name === 'add_to_cart') {
        response = await callInternalApi(router, requestCtx, 'POST', '/api/cart/items', {
          bookId: safeArgs.bookId, quantity: safeArgs.quantity,
        });
        outcome = { ok: true, result: sanitizeCart(response.payload) };
      }
      if (name === 'update_cart') {
        response = await callInternalApi(router, requestCtx, 'PATCH', `/api/cart/items/${Number(safeArgs.bookId)}`, { quantity: safeArgs.quantity });
        outcome = { ok: true, result: sanitizeCart(response.payload) };
      }
      if (name === 'remove_from_cart') {
        await callInternalApi(router, requestCtx, 'DELETE', `/api/cart/items/${Number(safeArgs.bookId)}`, {});
        response = await callInternalApi(router, requestCtx, 'GET', '/api/cart', {});
        outcome = { ok: true, result: sanitizeCart(response.payload) };
      }
      if (name === 'add_matching_books_to_cart') {
        const criteria = {};
        if (safeArgs.query) criteria.query = safeArgs.query;
        if (safeArgs.category) criteria.category = safeArgs.category;
        const matches = Object.keys(criteria).length ? searchAllBooks(criteria).books : [];
        bookContext.splice(0, bookContext.length, ...matches.map((book) => Object.assign({}, book)));

        response = await callInternalApi(router, requestCtx, 'GET', '/api/cart', {});
        const currentItems = Array.isArray(response.payload && response.payload.items) ? response.payload.items : [];
        const existingIds = new Set(currentItems.map((item) => Number(item.bookId)));
        const addedBooks = [];
        const alreadyPresentBooks = [];
        const outOfStockBooks = [];
        const failedBooks = [];
        for (const book of matches) {
          if (!book.inStock) {
            outOfStockBooks.push(book);
            continue;
          }
          if (existingIds.has(Number(book.id))) {
            alreadyPresentBooks.push(book);
            continue;
          }
          try {
            // eslint-disable-next-line no-await-in-loop
            response = await callInternalApi(router, requestCtx, 'POST', '/api/cart/items', { bookId: book.id, quantity: 1 });
            existingIds.add(Number(book.id));
            addedBooks.push(book);
          } catch (error) {
            failedBooks.push({ id: book.id, title: book.title, reason: error instanceof ApiError ? error.message : 'Could not add this book.' });
          }
        }
        response = await callInternalApi(router, requestCtx, 'GET', '/api/cart', {});
        outcome = {
          ok: true,
          result: Object.assign(sanitizeCart(response.payload), {
            matchedCount: matches.length,
            addedBooks,
            alreadyPresentBooks,
            outOfStockBooks,
            failedBooks,
          }),
        };
      }
      if (name === 'list_orders') {
        const limit = Math.max(1, Math.min(10, Number.parseInt(safeArgs.limit, 10) || 5));
        response = await callInternalApi(router, requestCtx, 'GET', `/api/orders?limit=${limit}&sort=createdAt&order=desc&scope=mine`, {});
        const rows = response.payload && Array.isArray(response.payload.data) ? response.payload.data : [];
        outcome = { ok: true, result: { orders: rows.map(sanitizeOrder), total: response.payload.meta ? response.payload.meta.total : rows.length } };
      }
      if (name === 'get_order' || name === 'cancel_order') {
        const method = name === 'cancel_order' ? 'POST' : 'GET';
        const suffix = name === 'cancel_order' ? '/cancel' : '';
        response = await callInternalApi(router, requestCtx, method, `/api/orders/${Number(safeArgs.orderId)}${suffix}`, {});
        outcome = { ok: true, result: sanitizeOrder(response.payload) };
      }
      if (!outcome) outcome = { ok: false, error: { code: 'UNKNOWN_TOOL', message: 'That application operation is not available.' } };
      const customerMessage = customerMessageFor(name, outcome, safeArgs, userMessage);
      return customerMessage ? Object.assign(outcome, { customerMessage }) : outcome;
    } catch (error) {
      const outcome = toolError(error);
      outcome.customerMessage = customerMessageFor(name, outcome, safeArgs, userMessage);
      return outcome;
    }
  }
  executeTool.normalizeArguments = (name, args) => normalizeToolArguments(name, args, userMessage, { bookContext });
  executeTool.verifiedBookIds = () => bookContext
    .map((book) => Number(book && book.id))
    .filter((id) => Number.isInteger(id) && id > 0);
  return executeTool;
}

function deterministicResult(outcome, clientAction) {
  if (!outcome) return null;
  const content = typeof outcome.customerMessage === 'string' && outcome.customerMessage.trim()
    ? outcome.customerMessage.trim()
    : 'I could not complete that request safely.';
  return clientAction ? { content, clientAction } : { content };
}

async function runDeterministicCommand(message, executeTool, bookContext) {
  const text = cleanText(message);
  if (asksBulkAdd(text)) {
    return deterministicResult(await executeTool('add_matching_books_to_cart', explicitCatalogTopic(text)));
  }

  if (asksCheckout(text)) {
    const cart = await executeTool('view_cart', {});
    const hasItems = cart && cart.ok === true && cart.result
      && Array.isArray(cart.result.items) && cart.result.items.length > 0;
    return deterministicResult(cart, hasItems ? 'open_checkout' : null);
  }

  if (asksCartRemoval(text)) {
    const cart = await executeTool('view_cart', {});
    if (!cart || cart.ok !== true) return deterministicResult(cart);
    const items = cart.result && Array.isArray(cart.result.items) ? cart.result.items : [];
    if (!items.length) return deterministicResult(cart);
    const context = items.map((item) => ({ id: item.bookId, title: item.title }));
    const target = resolveBookReference(text, context);
    if (target) return deterministicResult(await executeTool('remove_from_cart', { bookId: target.id }));
    return {
      content: `${formatCart(cart.result, 'view_cart', {})}\n\nTell me the title or option number of the item you want to remove. I have not changed your cart.`,
    };
  }

  if (asksBestBook(text)) {
    const category = commonContextCategory(bookContext);
    if (category) {
      return deterministicResult(await executeTool('search_books', {
        category, inStock: true, sort: 'averageRating', order: 'desc', limit: 10,
      }));
    }
  }

  const topic = explicitCatalogTopic(text);
  const looksLikeSearch = /\b(?:show|find|list|check|any|more|other|available|books?|titles?)\b/i.test(text)
    && !/\b(?:add|put|remove|delete)\b/i.test(text);
  if (looksLikeSearch && (topic.query || topic.category)) {
    return deterministicResult(await executeTool('search_books', Object.assign({ limit: 5 }, topic)));
  }

  if (asksMoreBooks(text)) {
    const category = commonContextCategory(bookContext);
    if (category) return deterministicResult(await executeTool('search_books', { category, limit: 10 }));
  }
  return null;
}

module.exports = {
  TOOL_DEFINITIONS,
  asksBulkAdd,
  asksCheckout,
  asksForAvailability,
  createToolExecutor,
  customerMessageFor,
  explicitQuantity,
  normalizeToolArguments,
  resolveBookReference,
  runDeterministicCommand,
  sanitizeCart,
  sanitizeOrder,
};
