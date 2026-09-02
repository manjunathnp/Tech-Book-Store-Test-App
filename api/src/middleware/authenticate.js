'use strict';

/*
 * Authentication middleware for the main JWT-protected routes.
 *
 * It reads the Authorization header, expects "Bearer <token>", verifies the
 * token signature and expiry, checks the token was not logged out (revoked),
 * loads the matching user, and attaches ctx.user for downstream handlers.
 *
 * Any failure throws 401 Unauthorized with a clear message so learners can
 * see exactly which condition failed (missing header, bad signature, expired,
 * or logged out).
 */

const jwt = require('../auth/jwt');
const tokens = require('../auth/tokens');
const config = require('../config');
const store = require('../store');
const { UnauthorizedError } = require('../lib/errors');

function requireAuth(ctx) {
  const header = ctx.req.headers['authorization'] || '';
  if (!header.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing or malformed Authorization header. Expected "Bearer <token>".');
  }

  const token = header.slice('Bearer '.length).trim();

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch (err) {
    if (err.reason === 'expired') {
      throw new UnauthorizedError('Access token has expired. Use the refresh token to get a new one.');
    }
    if (err.reason === 'signature') {
      throw new UnauthorizedError('Access token signature is invalid.');
    }
    throw new UnauthorizedError('Access token is malformed.');
  }

  if (payload.jti && tokens.isAccessJtiRevoked(payload.jti)) {
    throw new UnauthorizedError('This token was logged out and can no longer be used.');
  }

  const user = store.getState().users.find((u) => u.id === payload.sub);
  if (!user) {
    throw new UnauthorizedError('The user for this token no longer exists.');
  }

  ctx.user = user;
  ctx.tokenPayload = payload;
  // returning nothing continues to the next handler
}

// Public routes such as the chatbot may be used anonymously, while still
// honoring a valid Bearer token when one is supplied. A supplied but invalid
// token is rejected rather than silently downgrading the request to anonymous.
function optionalAuth(ctx) {
  const header = ctx.req.headers['authorization'] || '';
  if (!header) return;
  requireAuth(ctx);
}

module.exports = { requireAuth, optionalAuth };
