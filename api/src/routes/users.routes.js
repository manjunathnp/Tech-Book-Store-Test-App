'use strict';

/*
 * Users resource.
 *
 *   GET    /api/users          -> list users (admin only)
 *   GET    /api/users/:id      -> get a user (admin, or the user themselves)
 *   PATCH  /api/users/:id      -> update own profile (or admin updates anyone)
 *   DELETE /api/users/:id      -> delete a user (admin only)
 *
 * This shows ownership-based authorization: a normal user may read/update only
 * their own record, while an admin may act on anyone. Password hashes are
 * never returned.
 */

const store = require('../store');
const { applyQuery } = require('../lib/query');
const { validate } = require('../lib/validate');
const { hashPassword } = require('../auth/password');
const {
  NotFoundError, ForbiddenError, ConflictError,
} = require('../lib/errors');
const { requireAuth } = require('../middleware/authenticate');
const { requireRole } = require('../middleware/authorize');
const { publicUser } = require('./auth.routes');

function users() { return store.getState().users; }
function findUser(id) { return users().find((u) => u.id === Number(id)); }

function registerUserRoutes(router) {
  // LIST (admin only)
  router.get('/api/users', requireAuth, requireRole('admin'), (ctx) => {
    const result = applyQuery(users(), ctx.url.searchParams, { searchableFields: ['name', 'email'] });
    result.data = result.data.map((u) => (u.passwordHash ? publicUser(u) : u));
    ctx.json(200, result);
  });

  // GET ONE (admin or self)
  router.get('/api/users/:id', requireAuth, (ctx) => {
    const user = findUser(ctx.params.id);
    if (!user) throw new NotFoundError(`User ${ctx.params.id} was not found.`);
    if (ctx.user.role !== 'admin' && ctx.user.id !== user.id) {
      throw new ForbiddenError('You may only view your own profile.');
    }
    ctx.json(200, publicUser(user));
  });

  // UPDATE (admin or self)
  router.patch('/api/users/:id', requireAuth, (ctx) => {
    const user = findUser(ctx.params.id);
    if (!user) throw new NotFoundError(`User ${ctx.params.id} was not found.`);
    if (ctx.user.role !== 'admin' && ctx.user.id !== user.id) {
      throw new ForbiddenError('You may only update your own profile.');
    }

    validate(ctx.body, {
      name: { type: 'string', min: 1, max: 120 },
      email: { type: 'string', email: true },
      password: { type: 'string', min: 6, max: 200 },
    }, { partial: true });

    if (ctx.body.email !== undefined) {
      const email = String(ctx.body.email).toLowerCase();
      const clash = users().some((u) => u.id !== user.id && u.email.toLowerCase() === email);
      if (clash) throw new ConflictError(`Email ${email} is already in use.`);
      user.email = email;
    }
    if (ctx.body.name !== undefined) user.name = ctx.body.name;
    if (ctx.body.password !== undefined) user.passwordHash = hashPassword(ctx.body.password);
    user.updatedAt = new Date().toISOString();

    ctx.json(200, publicUser(user));
  });

  // DELETE (admin only)
  router.delete('/api/users/:id', requireAuth, requireRole('admin'), (ctx) => {
    const list = users();
    const idx = list.findIndex((u) => u.id === Number(ctx.params.id));
    if (idx === -1) throw new NotFoundError(`User ${ctx.params.id} was not found.`);
    list.splice(idx, 1);
    ctx.noContent();
  });
}

module.exports = { registerUserRoutes };
