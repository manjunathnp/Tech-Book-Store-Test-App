'use strict';

/*
 * Authentication endpoints.
 *
 *   POST /api/auth/register  -> create a new user (always role "user")
 *   POST /api/auth/login     -> exchange email + password for tokens
 *   POST /api/auth/refresh   -> exchange a refresh token for a NEW token pair
 *   POST /api/auth/logout    -> revoke the current access token (needs auth)
 *   GET  /api/auth/me        -> return the current user's profile (needs auth)
 *
 * The refresh endpoint ROTATES tokens: the old refresh token is consumed and a
 * fresh pair is returned. Reusing an old refresh token afterwards fails, which
 * is exactly how real, secure refresh flows behave.
 */

const crypto = require('crypto');
const store = require('../store');
const config = require('../config');
const { validate } = require('../lib/validate');
const { hashPassword, verifyPasswordAsync } = require('../auth/password');
const tokens = require('../auth/tokens');
const { loginRateLimit } = require('../middleware/rateLimit');
const {
  UnauthorizedError, ConflictError, BadRequestError,
} = require('../lib/errors');
const { requireAuth } = require('../middleware/authenticate');

// Keep unknown-account login work comparable to a real account so response
// timing does not become an account-enumeration signal.
const DUMMY_PASSWORD_HASH = hashPassword('not-a-real-user-password');

function publicUser(user) {
  // Never expose the password hash.
  return {
    id: user.id,
    uuid: user.uuid,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function registerAuthRoutes(router) {
  // REGISTER
  router.post('/api/auth/register', (ctx) => {
    const normalized = Object.assign({}, ctx.body, {
      name: typeof ctx.body.name === 'string' ? ctx.body.name.trim() : ctx.body.name,
      email: typeof ctx.body.email === 'string' ? ctx.body.email.trim().toLowerCase() : ctx.body.email,
    });
    validate(normalized, {
      name: { type: 'string', required: true, min: 2, max: 80 },
      email: { type: 'string', required: true, email: true, max: 254 },
      password: { type: 'string', required: true, min: 6, max: 200 },
    });

    const email = normalized.email;
    const exists = store.getState().users.some((u) => u.email.toLowerCase() === email);
    if (exists) {
      throw new ConflictError(`A user with email ${email} already exists.`);
    }

    const id = store.nextId('users');
    const user = {
      id,
      uuid: crypto.randomUUID(),
      name: normalized.name,
      email,
      passwordHash: hashPassword(ctx.body.password),
      role: 'user', // new sign-ups are always normal users
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.getState().users.push(user);

    const issued = tokens.issueTokensForUser(user);
    ctx.json(201, { user: publicUser(user), tokens: issued }, {
      Location: `/api/users/${id}`,
    });
  });

  // LOGIN
  router.post('/api/auth/login', loginRateLimit, async (ctx) => {
    const normalizedEmail = typeof ctx.body.email === 'string' ? ctx.body.email.trim().toLowerCase() : ctx.body.email;
    validate(Object.assign({}, ctx.body, { email: normalizedEmail }), {
      email: { type: 'string', required: true, email: true, max: 254 },
      password: { type: 'string', required: true, min: 1 },
    });

    const email = normalizedEmail;
    const user = store.getState().users.find((u) => u.email.toLowerCase() === email);

    // Use the same error whether the email is unknown or the password is wrong,
    // so attackers cannot tell which accounts exist.
    const passwordMatches = await verifyPasswordAsync(ctx.body.password, user ? user.passwordHash : DUMMY_PASSWORD_HASH);
    if (!user || !passwordMatches) {
      throw new UnauthorizedError('Invalid email or password.');
    }

    const issued = tokens.issueTokensForUser(user);
    ctx.json(200, { user: publicUser(user), tokens: issued });
  });

  // REFRESH (rotating)
  router.post('/api/auth/refresh', (ctx) => {
    const refreshToken = ctx.body.refreshToken;
    if (!refreshToken || typeof refreshToken !== 'string') {
      throw new BadRequestError('refreshToken is required in the request body.');
    }

    const userId = tokens.consumeRefreshToken(refreshToken);
    if (!userId) {
      throw new UnauthorizedError('Refresh token is invalid, expired, or already used.');
    }

    const user = store.getState().users.find((u) => u.id === userId);
    if (!user) {
      throw new UnauthorizedError('The user for this refresh token no longer exists.');
    }

    const issued = tokens.issueTokensForUser(user);
    ctx.json(200, { user: publicUser(user), tokens: issued });
  });

  // LOGOUT (revokes every token for this user, including refresh tokens)
  router.post('/api/auth/logout', requireAuth, (ctx) => {
    tokens.revokeAllForUser(ctx.user.id);
    ctx.json(200, { message: 'Logged out. All active sessions for this user have been revoked.' });
  });

  // CURRENT USER
  router.get('/api/auth/me', requireAuth, (ctx) => {
    ctx.json(200, publicUser(ctx.user));
  });
}

module.exports = { registerAuthRoutes, publicUser };
