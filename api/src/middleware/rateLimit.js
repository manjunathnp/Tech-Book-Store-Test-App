'use strict';

/*
 * A simple fixed-window rate limiter for the dedicated practice endpoint
 * GET /api/limited. It counts requests per client within a time window and
 * returns 429 Too Many Requests (with a Retry-After header) once the limit
 * is exceeded. The window resets automatically.
 *
 * Keeping this on a single dedicated endpoint means normal CRUD practice is
 * never accidentally throttled, while learners still get a clean, repeatable
 * 429 lesson on demand.
 */

const config = require('../config');
const { RateLimitError } = require('../lib/errors');

// clientKey -> { count, windowStart }
let buckets = new Map();
let loginBuckets = new Map();
let loginIpBuckets = new Map();

function reset() {
  buckets = new Map();
  loginBuckets = new Map();
  loginIpBuckets = new Map();
}

function clientKeyFor(ctx) {
  // Group by remote address; fall back to a constant for local practice.
  return ctx.req.socket.remoteAddress || 'local';
}

function rateLimit(ctx) {
  const key = clientKeyFor(ctx);
  const now = Date.now();
  let bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart >= config.rateLimitWindowMs) {
    bucket = { count: 0, windowStart: now };
    buckets.set(key, bucket);
  }

  bucket.count += 1;

  const remaining = Math.max(0, config.rateLimitMax - bucket.count);
  const resetInSeconds = Math.ceil((bucket.windowStart + config.rateLimitWindowMs - now) / 1000);

  ctx.res.setHeader('X-RateLimit-Limit', String(config.rateLimitMax));
  ctx.res.setHeader('X-RateLimit-Remaining', String(remaining));
  ctx.res.setHeader('X-RateLimit-Reset', String(resetInSeconds));

  if (bucket.count > config.rateLimitMax) {
    throw new RateLimitError(resetInSeconds, `Rate limit of ${config.rateLimitMax} requests per ${config.rateLimitWindowMs / 1000}s exceeded.`);
  }
}

function loginRateLimit(ctx) {
  const email = ctx.body && typeof ctx.body.email === 'string' ? ctx.body.email.trim().toLowerCase() : 'unknown';
  const clientKey = clientKeyFor(ctx);
  const key = `${clientKey}:${email}`;
  const now = Date.now();
  function increment(map, bucketKey) {
    let bucket = map.get(bucketKey);
    if (!bucket || now - bucket.windowStart >= config.loginRateLimitWindowMs) {
      bucket = { count: 0, windowStart: now };
      map.set(bucketKey, bucket);
    }
    bucket.count += 1;
    return bucket;
  }
  const accountBucket = increment(loginBuckets, key);
  const ipBucket = increment(loginIpBuckets, clientKey);
  const remaining = Math.max(0, Math.min(config.loginRateLimitMax - accountBucket.count, config.loginIpRateLimitMax - ipBucket.count));
  const resetInSeconds = Math.max(1, Math.ceil((Math.min(accountBucket.windowStart, ipBucket.windowStart) + config.loginRateLimitWindowMs - now) / 1000));
  ctx.res.setHeader('X-RateLimit-Limit', String(config.loginRateLimitMax));
  ctx.res.setHeader('X-RateLimit-Remaining', String(remaining));
  ctx.res.setHeader('X-RateLimit-Reset', String(resetInSeconds));
  if (accountBucket.count > config.loginRateLimitMax || ipBucket.count > config.loginIpRateLimitMax) {
    throw new RateLimitError(resetInSeconds, 'Too many login attempts. Please wait before trying again.');
  }
}

module.exports = { rateLimit, loginRateLimit, reset };
