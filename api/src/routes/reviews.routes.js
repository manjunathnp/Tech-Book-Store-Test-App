'use strict';

/*
 * Reviews. A review belongs to a book and to the user who wrote it.
 *
 *   GET    /api/reviews            -> list all reviews (with query features)
 *   GET    /api/reviews/:id        -> get one review
 *   POST   /api/books/:id/reviews  -> create a review for a book (auth)
 *   PATCH  /api/reviews/:id        -> update own review (or admin)
 *   DELETE /api/reviews/:id        -> delete own review (or admin)
 *
 * Creating a review under a book is a natural chaining exercise: create a
 * book, capture its id, then post a review to that id, then read it back.
 * A user may review a given book only once (second attempt returns 409).
 */

const crypto = require('crypto');
const store = require('../store');
const { applyQuery } = require('../lib/query');
const { validate } = require('../lib/validate');
const {
  NotFoundError, ForbiddenError, ConflictError, GoneError, ValidationError,
} = require('../lib/errors');
const { requireAuth } = require('../middleware/authenticate');

function reviews() { return store.getState().reviews; }
function findReview(id) { return reviews().find((r) => r.id === Number(id)); }
function findBook(id) { return store.getState().books.find((b) => b.id === Number(id)); }

function registerReviewRoutes(router) {
  // LIST
  router.get('/api/reviews', (ctx) => {
    const result = applyQuery(reviews(), ctx.url.searchParams, { searchableFields: ['title', 'body'] });
    ctx.json(200, result);
  });

  // GET ONE
  router.get('/api/reviews/:id', (ctx) => {
    const review = findReview(ctx.params.id);
    if (!review) throw new NotFoundError(`Review ${ctx.params.id} was not found.`);
    ctx.json(200, review);
  });

  // CREATE under a book (auth required)
  router.post('/api/books/:id/reviews', requireAuth, (ctx) => {
    const book = findBook(ctx.params.id);
    if (!book) throw new NotFoundError(`Book ${ctx.params.id} was not found.`);
    if (book.deleted) throw new GoneError(`Book ${ctx.params.id} has been deleted.`);

    validate(ctx.body, {
      rating: { type: 'integer', required: true, min: 1, max: 5 },
      title: { type: 'string', required: true, min: 1, max: 120 },
      body: { type: 'string', required: true, min: 1, max: 5000 },
    });

    const cleanTitle = ctx.body.title.trim();
    const cleanBody = ctx.body.body.trim();
    const blankDetails = [];
    if (!cleanTitle) blankDetails.push({ field: 'title', message: 'Review title cannot be empty or whitespace only.', code: 'required' });
    if (!cleanBody) blankDetails.push({ field: 'body', message: 'Review body cannot be empty or whitespace only.', code: 'required' });
    if (blankDetails.length) throw new ValidationError(blankDetails);

    const already = reviews().some((r) => r.bookId === book.id && r.userId === ctx.user.id);
    if (already) {
      throw new ConflictError('You have already reviewed this book.');
    }

    const id = store.nextId('reviews');
    const review = {
      id,
      uuid: crypto.randomUUID(),
      bookId: book.id,
      userId: ctx.user.id,
      rating: ctx.body.rating,
      title: cleanTitle,
      body: cleanBody,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    reviews().push(review);
    ctx.json(201, review, { Location: `/api/reviews/${id}` });
  });

  // UPDATE (owner or admin)
  router.patch('/api/reviews/:id', requireAuth, (ctx) => {
    const review = findReview(ctx.params.id);
    if (!review) throw new NotFoundError(`Review ${ctx.params.id} was not found.`);
    if (ctx.user.role !== 'admin' && review.userId !== ctx.user.id) {
      throw new ForbiddenError('You may only edit your own review.');
    }
    validate(ctx.body, {
      rating: { type: 'integer', min: 1, max: 5 },
      title: { type: 'string', min: 1, max: 120 },
      body: { type: 'string', min: 1, max: 5000 },
    }, { partial: true });

    if (ctx.body.rating !== undefined) review.rating = ctx.body.rating;
    if (ctx.body.title !== undefined) {
      const title = ctx.body.title.trim();
      if (!title) throw new ValidationError([{ field: 'title', message: 'Review title cannot be empty or whitespace only.', code: 'required' }]);
      review.title = title;
    }
    if (ctx.body.body !== undefined) {
      const body = ctx.body.body.trim();
      if (!body) throw new ValidationError([{ field: 'body', message: 'Review body cannot be empty or whitespace only.', code: 'required' }]);
      review.body = body;
    }
    review.updatedAt = new Date().toISOString();
    ctx.json(200, review);
  });

  // DELETE (owner or admin)
  router.delete('/api/reviews/:id', requireAuth, (ctx) => {
    const list = reviews();
    const idx = list.findIndex((r) => r.id === Number(ctx.params.id));
    if (idx === -1) throw new NotFoundError(`Review ${ctx.params.id} was not found.`);
    const review = list[idx];
    if (ctx.user.role !== 'admin' && review.userId !== ctx.user.id) {
      throw new ForbiddenError('You may only delete your own review.');
    }
    list.splice(idx, 1);
    ctx.noContent();
  });
}

module.exports = { registerReviewRoutes };
