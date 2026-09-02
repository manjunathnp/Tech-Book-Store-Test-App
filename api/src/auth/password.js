'use strict';

/*
 * Password hashing using only Node's built-in crypto module.
 *
 * We never store raw passwords. We store a salted PBKDF2 hash. On login we
 * hash the supplied password with the same salt and compare using a
 * constant-time comparison so timing cannot leak information.
 *
 * Stored format: "pbkdf2$<iterations>$<saltHex>$<hashHex>"
 */

const crypto = require('crypto');

const ITERATIONS = 120000;
const KEY_LENGTH = 32;
const DIGEST = 'sha256';

function hashPassword(plainPassword) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.pbkdf2Sync(plainPassword, salt, ITERATIONS, KEY_LENGTH, DIGEST);
  return `pbkdf2$${ITERATIONS}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

function verifyPassword(plainPassword, stored) {
  try {
    const [scheme, iterationsStr, saltHex, hashHex] = String(stored).split('$');
    if (scheme !== 'pbkdf2') return false;
    const iterations = Number.parseInt(iterationsStr, 10);
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const derived = crypto.pbkdf2Sync(plainPassword, salt, iterations, expected.length, DIGEST);
    // Lengths must match before timingSafeEqual, or it throws.
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch (err) {
    return false;
  }
}

function verifyPasswordAsync(plainPassword, stored) {
  return new Promise((resolve) => {
    try {
      const [scheme, iterationsStr, saltHex, hashHex] = String(stored).split('$');
      if (scheme !== 'pbkdf2') { resolve(false); return; }
      const iterations = Number.parseInt(iterationsStr, 10);
      const salt = Buffer.from(saltHex, 'hex');
      const expected = Buffer.from(hashHex, 'hex');
      crypto.pbkdf2(plainPassword, salt, iterations, expected.length, DIGEST, (err, derived) => {
        if (err || derived.length !== expected.length) { resolve(false); return; }
        resolve(crypto.timingSafeEqual(derived, expected));
      });
    } catch (err) {
      resolve(false);
    }
  });
}

module.exports = { hashPassword, verifyPassword, verifyPasswordAsync };
