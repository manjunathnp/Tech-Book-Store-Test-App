'use strict';

/*
 * Books: the richest resource. In addition to normal CRUD it demonstrates:
 *
 *   - Relationship validation: authorId / categoryId / publisherId must point
 *     at records that exist, else 422.
 *   - ETag + If-Match optimistic concurrency: each book has a version. GET
 *     returns an ETag header. PUT/PATCH may send If-Match; if it does not
 *     match the current version, the write is rejected with 412 so two clients
 *     cannot silently overwrite each other.
 *   - Soft delete: DELETE marks the book deleted instead of removing it.
 *     Fetching a soft-deleted book returns 410 Gone. A restore endpoint brings
 *     it back. Lists hide deleted books unless ?includeDeleted=true.
 */

const crypto = require('crypto');
const store = require('../store');
const { applyQuery } = require('../lib/query');
const { validate } = require('../lib/validate');
const {
  NotFoundError, GoneError, ValidationError, PreconditionFailedError,
} = require('../lib/errors');
const { requireAuth } = require('../middleware/authenticate');
const { requireRole } = require('../middleware/authorize');
const { nowIso } = require('./crudFactory');

const createSchema = {
  title: { type: 'string', required: true, min: 1, max: 200 },
  authorId: { type: 'integer', required: true, min: 1 },
  categoryId: { type: 'integer', required: true, min: 1 },
  publisherId: { type: 'integer', min: 1 },
  price: { type: 'number', required: true, min: 0, max: 100000 },
  pages: { type: 'integer', min: 1, max: 10000 },
  publishedYear: { type: 'integer', min: 1400, max: 2100 },
  inStock: { type: 'boolean' },
  stockCount: { type: 'integer', min: 0 },
  format: { type: 'string', enum: ['paperback', 'ebook', 'hardcover'] },
  description: { type: 'string', max: 5000 },
};

const updateSchema = Object.assign({}, createSchema, {
  title: { type: 'string', min: 1, max: 200 },
  authorId: { type: 'integer', min: 1 },
  categoryId: { type: 'integer', min: 1 },
  price: { type: 'number', min: 0, max: 100000 },
});

function books() { return store.getState().books; }

/*
 * Derive the real rating from actual reviews instead of the seeded number.
 * A book with no reviews reports averageRating: null and reviewCount: 0 so the
 * UI can show "Not yet rated" rather than fake empty stars. The legacy `rating`
 * field is left untouched for backward compatibility and sorting.
 */
function withDerivedRating(book) {
  const bookReviews = store.getState().reviews.filter((r) => r.bookId === book.id);
  const reviewCount = bookReviews.length;
  const averageRating = reviewCount === 0
    ? null
    : Number((bookReviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount).toFixed(1));
  return Object.assign({}, book, { averageRating, reviewCount });
}

function etagFor(book) {
  // Weak-style ETag derived from id + version. Changes whenever the book does.
  return `"book-${book.id}-v${book.version}"`;
}

function relationDetails(body) {
  const s = store.getState();
  const details = [];
  if (body.authorId !== undefined && !s.authors.some((a) => a.id === body.authorId)) {
    details.push({ field: 'authorId', message: `authorId ${body.authorId} does not exist.`, code: 'relation' });
  }
  if (body.categoryId !== undefined && !s.categories.some((c) => c.id === body.categoryId)) {
    details.push({ field: 'categoryId', message: `categoryId ${body.categoryId} does not exist.`, code: 'relation' });
  }
  if (body.publisherId !== undefined && !s.publishers.some((p) => p.id === body.publisherId)) {
    details.push({ field: 'publisherId', message: `publisherId ${body.publisherId} does not exist.`, code: 'relation' });
  }
  return details;
}

function findBook(id) {
  return books().find((b) => b.id === Number(id));
}

function registerBookRoutes(router) {
  // LIST (hides soft-deleted unless includeDeleted=true)
  router.get('/api/books', (ctx) => {
    const includeDeleted = ctx.url.searchParams.get('includeDeleted') === 'true';
    const source = includeDeleted ? books() : books().filter((b) => !b.deleted);
    // Add computed fields before the query pipeline so sorting, filtering, and
    // sparse fieldsets all observe the same response shape. Mapping afterwards
    // leaked averageRating and reviewCount into requests that explicitly asked
    // for fields such as ?fields=id,title.
    const result = applyQuery(source.map(withDerivedRating), ctx.url.searchParams, {
      searchableFields: ['title', 'description', 'isbn'],
    });
    ctx.json(200, result);
  });

  // GET ONE (410 if soft-deleted, ETag header on success)
  router.get('/api/books/:id', (ctx) => {
    const book = findBook(ctx.params.id);
    if (!book) throw new NotFoundError(`Book ${ctx.params.id} was not found.`);
    if (book.deleted) throw new GoneError(`Book ${ctx.params.id} has been deleted.`);
    ctx.json(200, withDerivedRating(book), { ETag: etagFor(book) });
  });

  // Nested: reviews for a book (chaining practice)
  router.get('/api/books/:id/reviews', (ctx) => {
    const book = findBook(ctx.params.id);
    if (!book) throw new NotFoundError(`Book ${ctx.params.id} was not found.`);
    const list = store.getState().reviews.filter((r) => r.bookId === book.id);
    const result = applyQuery(list, ctx.url.searchParams, { searchableFields: ['title', 'body'] });
    ctx.json(200, result);
  });

  // CREATE (admin)
  router.post('/api/books', requireAuth, requireRole('admin'), (ctx) => {
    validate(ctx.body, createSchema);
    const relErrors = relationDetails(ctx.body);
    if (relErrors.length > 0) throw new ValidationError(relErrors);

    const id = store.nextId('books');
    const b = ctx.body;
    const book = {
      id,
      uuid: crypto.randomUUID(),
      title: b.title,
      isbn: b.isbn || '978' + String(1000000000 + id * 37).slice(0, 10),
      authorId: b.authorId,
      categoryId: b.categoryId,
      publisherId: b.publisherId || null,
      price: b.price,
      currency: b.currency || 'INR',
      pages: b.pages || null,
      rating: 0,
      inStock: b.inStock !== undefined ? b.inStock : true,
      stockCount: b.stockCount !== undefined ? b.stockCount : 0,
      publishedYear: b.publishedYear || new Date().getFullYear(),
      language: b.language || 'English',
      format: b.format || 'paperback',
      tags: Array.isArray(b.tags) ? b.tags : [],
      description: b.description || '',
      version: 1,
      deleted: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    books().push(book);
    ctx.json(201, book, { Location: `/api/books/${id}`, ETag: etagFor(book) });
  });

  // Shared write logic for PUT/PATCH with optional If-Match concurrency check.
  function writeBook(ctx, { partial }) {
    const book = findBook(ctx.params.id);
    if (!book) throw new NotFoundError(`Book ${ctx.params.id} was not found.`);
    if (book.deleted) throw new GoneError(`Book ${ctx.params.id} has been deleted.`);

    // Optimistic concurrency: if the client sends If-Match, it must equal the
    // current ETag. This prevents overwriting a book that changed meanwhile.
    const ifMatch = ctx.req.headers['if-match'];
    if (ifMatch && ifMatch !== etagFor(book)) {
      throw new PreconditionFailedError(
        'If-Match does not match the current version of this book. Re-fetch and retry.'
      );
    }

    validate(ctx.body, partial ? updateSchema : createSchema, { partial });
    const relErrors = relationDetails(ctx.body);
    if (relErrors.length > 0) throw new ValidationError(relErrors);

    const fields = ['title', 'authorId', 'categoryId', 'publisherId', 'price', 'currency',
      'pages', 'inStock', 'stockCount', 'publishedYear', 'language', 'format', 'tags', 'description', 'isbn'];
    for (const f of fields) {
      if (ctx.body[f] !== undefined) book[f] = ctx.body[f];
    }
    book.version += 1; // bump version so the ETag changes
    book.updatedAt = nowIso();
    ctx.json(200, book, { ETag: etagFor(book) });
  }

  router.put('/api/books/:id', requireAuth, requireRole('admin'), (ctx) => writeBook(ctx, { partial: false }));
  router.patch('/api/books/:id', requireAuth, requireRole('admin'), (ctx) => writeBook(ctx, { partial: true }));

  // SOFT DELETE (admin). Marks deleted; a later GET returns 410 Gone.
  router.delete('/api/books/:id', requireAuth, requireRole('admin'), (ctx) => {
    const book = findBook(ctx.params.id);
    if (!book) throw new NotFoundError(`Book ${ctx.params.id} was not found.`);
    if (book.deleted) throw new GoneError(`Book ${ctx.params.id} is already deleted.`);
    book.deleted = true;
    book.updatedAt = nowIso();
    ctx.noContent();
  });

  // RESTORE a soft-deleted book (admin).
  router.post('/api/books/:id/restore', requireAuth, requireRole('admin'), (ctx) => {
    const book = findBook(ctx.params.id);
    if (!book) throw new NotFoundError(`Book ${ctx.params.id} was not found.`);
    if (!book.deleted) {
      ctx.json(200, book, { ETag: etagFor(book) });
      return;
    }
    book.deleted = false;
    book.updatedAt = nowIso();
    ctx.json(200, book, { ETag: etagFor(book) });
  });
}

module.exports = { registerBookRoutes, etagFor };
