'use strict';

/*
 * Role-based authorization. Use after requireAuth. Returns a middleware that
 * allows the request only if the authenticated user has one of the allowed
 * roles, otherwise throws 403 Forbidden.
 *
 *   router.post('/api/books', requireAuth, requireRole('admin'), createBook)
 *
 * The difference learners should notice:
 *   401 Unauthorized -> "I don't know who you are" (no / bad token)
 *   403 Forbidden    -> "I know who you are, but you're not allowed"
 */

const { ForbiddenError, UnauthorizedError } = require('../lib/errors');

function requireRole(...allowedRoles) {
  return function authorize(ctx) {
    if (!ctx.user) {
      throw new UnauthorizedError('Authentication is required.');
    }
    if (!allowedRoles.includes(ctx.user.role)) {
      throw new ForbiddenError(
        `This action requires one of these roles: ${allowedRoles.join(', ')}. Your role is "${ctx.user.role}".`
      );
    }
  };
}

module.exports = { requireRole };
