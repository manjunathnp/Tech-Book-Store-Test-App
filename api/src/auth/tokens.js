'use strict';

/*
 * Token lifecycle manager.
 *
 * This ties the raw JWT helper to real login behaviour:
 *   - issue an access token (short life) and a refresh token (long life)
 *   - rotate refresh tokens: using a refresh token invalidates it and returns
 *     a brand-new pair, so a stolen old refresh token stops working
 *   - logout: the current access token's id is remembered as "revoked" so
 *     reusing it returns 401 even though its signature is still valid
 *
 * All state is in memory and is cleared by POST /api/reset. This is perfect
 * for repeatable, offline practice.
 */

const crypto = require('crypto');
const jwt = require('./jwt');
const config = require('../config');

// jti (JWT id) values of access tokens that were explicitly logged out.
let revokedAccessJtis = new Set();

// Currently valid refresh tokens, keyed by the refresh token string.
// value: { userId, expiresAt }
let activeRefreshTokens = new Map();
let issuedAccessJtisByUser = new Map();

function reset() {
  revokedAccessJtis = new Set();
  activeRefreshTokens = new Map();
  issuedAccessJtisByUser = new Map();
}

function newJti() {
  return crypto.randomBytes(12).toString('hex');
}

function issueTokensForUser(user) {
  const jti = newJti();
  const userJtis = issuedAccessJtisByUser.get(user.id) || new Set();
  userJtis.add(jti);
  issuedAccessJtisByUser.set(user.id, userJtis);
  const accessToken = jwt.sign(
    { sub: user.id, email: user.email, role: user.role, jti },
    config.jwtSecret,
    config.accessTokenTtl
  );

  const refreshToken = crypto.randomBytes(32).toString('hex');
  activeRefreshTokens.set(refreshToken, {
    userId: user.id,
    expiresAt: Date.now() + config.refreshTokenTtl * 1000,
  });

  return {
    accessToken,
    refreshToken,
    tokenType: 'Bearer',
    expiresIn: config.accessTokenTtl,
  };
}

// Returns the userId for a valid, unexpired refresh token, else null.
// Consumes (rotates out) the token so it cannot be reused.
function consumeRefreshToken(refreshToken) {
  const record = activeRefreshTokens.get(refreshToken);
  if (!record) return null;
  activeRefreshTokens.delete(refreshToken); // rotation: one-time use
  if (Date.now() >= record.expiresAt) return null;
  return record.userId;
}

function revokeAccessJti(jti) {
  if (jti) revokedAccessJtis.add(jti);
}

// Logout is account-session wide: revoke every access and refresh token that
// this process has issued for the user so another browser tab cannot revive it.
function revokeAllForUser(userId) {
  const accessJtis = issuedAccessJtisByUser.get(userId) || new Set();
  for (const jti of accessJtis) revokedAccessJtis.add(jti);
  issuedAccessJtisByUser.delete(userId);
  for (const [refreshToken, record] of activeRefreshTokens.entries()) {
    if (record.userId === userId) activeRefreshTokens.delete(refreshToken);
  }
}

function isAccessJtiRevoked(jti) {
  return revokedAccessJtis.has(jti);
}

module.exports = {
  reset,
  issueTokensForUser,
  consumeRefreshToken,
  revokeAccessJti,
  revokeAllForUser,
  isAccessJtiRevoked,
};
