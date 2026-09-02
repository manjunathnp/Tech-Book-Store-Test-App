'use strict';

/*
 * Permissive CORS so the API can be called from a browser page, Swagger UI,
 * or any local tool without cross-origin errors. Suitable for a practice app.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type,Authorization,X-API-Key,If-Match,Idempotency-Key,X-Request-Id',
  'Access-Control-Expose-Headers':
    'ETag,Retry-After,Location,X-Request-Id,Allow',
  'Access-Control-Max-Age': '600',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' http://127.0.0.1:* http://localhost:* http://[::1]:*; frame-src 'self'",
};

function applyCorsHeaders(req, res) {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
}

module.exports = { applyCorsHeaders, CORS_HEADERS, SECURITY_HEADERS };
