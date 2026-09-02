'use strict';

/*
 * A reusable CRUD builder. Simple resources (authors, categories, publishers)
 * all behave the same way, so we generate their handlers from one factory.
 * This keeps behaviour identical and bug-for-bug consistent across resources,
 * and it is itself a nice example of DRY API design for learners to read.
 *
 * Books, users, reviews, cart, and orders have extra rules, so they are hand
 * written in their own files instead of using this factory.
 */

const store = require('../store');
const { applyQuery } = require('../lib/query');
const { validate } = require('../lib/validate');
const { NotFoundError } = require('../lib/errors');
const { requireAuth } = require('../middleware/authenticate');
const { requireRole } = require('../middleware/authorize');
const { NOW } = require('../seed');

function nowIso() {
  return new Date().toISOString();
}

function register(router, options) {
  const {
    basePath, // e.g. '/api/authors'
    collection, // e.g. 'authors' (key in store state and counters)
    singular, // e.g. 'Author'
    createSchema,
    updateSchema,
    searchableFields = [],
    buildCreate, // (body) => new record fields
    applyUpdate, // (record, body) => void (mutates record)
  } = options;

  function getCollection() {
    return store.getState()[collection];
  }

  function findById(id) {
    const numericId = Number(id);
    return getCollection().find((r) => r.id === numericId);
  }

  // LIST
  router.get(basePath, (ctx) => {
    const result = applyQuery(getCollection(), ctx.url.searchParams, { searchableFields });
    ctx.json(200, result);
  });

  // GET ONE
  router.get(`${basePath}/:id`, (ctx) => {
    const record = findById(ctx.params.id);
    if (!record) throw new NotFoundError(`${singular} ${ctx.params.id} was not found.`);
    ctx.json(200, record);
  });

  // CREATE (admin only)
  router.post(basePath, requireAuth, requireRole('admin'), (ctx) => {
    validate(ctx.body, createSchema);
    const id = store.nextId(collection);
    const base = buildCreate(ctx.body);
    const record = Object.assign(
      { id },
      base,
      { createdAt: nowIso(), updatedAt: nowIso() }
    );
    getCollection().push(record);
    ctx.json(201, record, { Location: `${basePath}/${id}` });
  });

  // FULL UPDATE (admin only)
  router.put(`${basePath}/:id`, requireAuth, requireRole('admin'), (ctx) => {
    const record = findById(ctx.params.id);
    if (!record) throw new NotFoundError(`${singular} ${ctx.params.id} was not found.`);
    validate(ctx.body, createSchema); // PUT replaces, so full schema applies
    applyUpdate(record, ctx.body);
    record.updatedAt = nowIso();
    ctx.json(200, record);
  });

  // PARTIAL UPDATE (admin only)
  router.patch(`${basePath}/:id`, requireAuth, requireRole('admin'), (ctx) => {
    const record = findById(ctx.params.id);
    if (!record) throw new NotFoundError(`${singular} ${ctx.params.id} was not found.`);
    validate(ctx.body, updateSchema, { partial: true });
    applyUpdate(record, ctx.body);
    record.updatedAt = nowIso();
    ctx.json(200, record);
  });

  // DELETE (admin only)
  router.delete(`${basePath}/:id`, requireAuth, requireRole('admin'), (ctx) => {
    const list = getCollection();
    const idx = list.findIndex((r) => r.id === Number(ctx.params.id));
    if (idx === -1) throw new NotFoundError(`${singular} ${ctx.params.id} was not found.`);
    list.splice(idx, 1);
    ctx.noContent();
  });
}

module.exports = { register, nowIso };
