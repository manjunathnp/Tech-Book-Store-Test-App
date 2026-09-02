'use strict';

/*
 * A minimal, correct JSON Web Token (JWT) implementation using only Node's
 * crypto module. This exists so the app has ZERO external dependencies while
 * still teaching real, standards-shaped tokens.
 *
 * A JWT has three parts joined by dots:  header.payload.signature
 *   - header:    base64url({ "alg": "HS256", "typ": "JWT" })
 *   - payload:   base64url(your claims, for example user id, role, exp)
 *   - signature: HMAC-SHA256 over "header.payload" using a secret key
 *
 * The signature is what makes a token tamper-proof: if anyone edits the
 * payload, the signature no longer matches and verification fails.
 *
 * This is intentionally readable so learners can open it and understand
 * exactly what a token is. It is NOT hardened for production use.
 */

const crypto = require('crypto');

function base64urlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecode(input) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64').toString('utf8');
}

function sign(payload, secret, expiresInSeconds) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const nowSeconds = Math.floor(Date.now() / 1000);

  const fullPayload = Object.assign({}, payload, {
    iat: nowSeconds, // issued-at time
    exp: nowSeconds + expiresInSeconds, // expiry time
  });

  const encodedHeader = base64urlEncode(JSON.stringify(header));
  const encodedPayload = base64urlEncode(JSON.stringify(fullPayload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return `${signingInput}.${signature}`;
}

/*
 * Verify a token. Returns the decoded payload if valid.
 * Throws an Error with a descriptive `.reason` when invalid:
 *   'malformed'  -> not three dot-separated parts
 *   'signature'  -> signature does not match (token was tampered with)
 *   'expired'    -> the exp claim is in the past
 */
function verify(token, secret) {
  const parts = String(token).split('.');
  if (parts.length !== 3) {
    const err = new Error('Malformed token.');
    err.reason = 'malformed';
    throw err;
  }

  const [encodedHeader, encodedPayload, providedSignature] = parts;
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  // Constant-time comparison to avoid timing attacks.
  const a = Buffer.from(providedSignature);
  const b = Buffer.from(expectedSignature);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    const err = new Error('Invalid token signature.');
    err.reason = 'signature';
    throw err;
  }

  let header;
  try {
    header = JSON.parse(base64urlDecode(encodedHeader));
  } catch (e) {
    const err = new Error('Malformed token header.');
    err.reason = 'malformed';
    throw err;
  }
  if (!header || header.alg !== 'HS256' || header.typ !== 'JWT') {
    const err = new Error('Unsupported token header.');
    err.reason = 'malformed';
    throw err;
  }

  let payload;
  try {
    payload = JSON.parse(base64urlDecode(encodedPayload));
  } catch (e) {
    const err = new Error('Malformed token payload.');
    err.reason = 'malformed';
    throw err;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(payload.sub) || payload.sub < 1
      || typeof payload.jti !== 'string' || !payload.jti
      || !Number.isFinite(payload.iat) || !Number.isFinite(payload.exp)) {
    const err = new Error('Required token claims are missing or invalid.');
    err.reason = 'malformed';
    throw err;
  }
  if (typeof payload.exp === 'number' && nowSeconds >= payload.exp) {
    const err = new Error('Token has expired.');
    err.reason = 'expired';
    throw err;
  }

  return payload;
}

/*
 * Decode without verifying. Useful only for reading claims for display.
 * Never trust the result of this for auth decisions.
 */
function decode(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(base64urlDecode(parts[1]));
  } catch (e) {
    return null;
  }
}

module.exports = { sign, verify, decode };
