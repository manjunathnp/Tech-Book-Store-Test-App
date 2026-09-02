'use strict';

/*
 * The application core. It:
 *   1. builds the router and registers every route module
 *   2. for each incoming request, builds a `ctx` object and runs the matched
 *      handler chain
 *   3. converts any thrown ApiError into the standard JSON error envelope
 *   4. handles 404 (no route) and 405 (wrong method) cleanly
 *
 * Everything funnels through here, which is why error formatting is consistent
 * across the whole API.
 */

const fs = require('fs');
const path = require('path');
const { Router } = require('./router');
const config = require('./config');
const { readJsonBody, parseUrl, sendJson, sendNoContent } = require('./lib/http');
const { ApiError } = require('./lib/errors');
const { applyCorsHeaders } = require('./middleware/cors');

const { registerSystemRoutes } = require('./routes/system.routes');
const { registerAuthRoutes } = require('./routes/auth.routes');
const { registerSimpleRoutes } = require('./routes/simple.routes');
const { registerBookRoutes } = require('./routes/books.routes');
const { registerUserRoutes } = require('./routes/users.routes');
const { registerReviewRoutes } = require('./routes/reviews.routes');
const { registerCartRoutes } = require('./routes/cart.routes');
const { registerOrderRoutes } = require('./routes/orders.routes');
const { registerChatRoutes } = require('./routes/chat.routes');
const { registerPracticeRoutes } = require('./routes/practice.routes');

const router = new Router();
registerSystemRoutes(router);
registerAuthRoutes(router);
registerSimpleRoutes(router);
registerBookRoutes(router);
registerUserRoutes(router);
registerReviewRoutes(router);
registerCartRoutes(router);
registerOrderRoutes(router);
registerChatRoutes(router);
registerPracticeRoutes(router);

// Pre-load the static docs assets once.
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const WEB_DIR = path.join(__dirname, '..', '..', 'web');
const STOREFRONT_FILE = path.join(WEB_DIR, 'techbookstore-shop.html');
const BOOK_COVERS_DIR = path.join(WEB_DIR, 'book-covers');
const BRAND_ASSETS_DIR = path.join(WEB_DIR, 'brand-assets');
function readDocsFile(name) {
  try {
    return fs.readFileSync(path.join(DOCS_DIR, name), 'utf8');
  } catch (e) {
    return null;
  }
}

function buildContext(req, res, url, body) {
  return {
    req,
    res,
    url,
    body,
    params: {},
    query: url.searchParams,
    user: null,
    tokenPayload: null,
    json(status, payload, extraHeaders) {
      sendJson(res, status, payload, extraHeaders);
    },
    noContent(extraHeaders) {
      sendNoContent(res, extraHeaders);
    },
  };
}

function sendError(res, err, requestId) {
  if (err instanceof ApiError) {
    const headers = Object.assign({}, err.headers || {});
    if (requestId) headers['X-Request-Id'] = requestId;
    sendJson(res, err.status, err.toEnvelope(), headers);
    return;
  }
  // Unexpected error -> 500 with a generic message (never leak internals).
  // eslint-disable-next-line no-console
  console.error('Unhandled error:', err);
  const headers = requestId ? { 'X-Request-Id': requestId } : {};
  sendJson(res, 500, {
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
  }, headers);
}

async function handleRequest(req, res) {
  const requestId = req.headers['x-request-id'] || Math.random().toString(36).slice(2, 10);
  applyCorsHeaders(req, res);
  res.setHeader('X-Request-Id', requestId);

  const url = parseUrl(req);
  const method = req.method.toUpperCase();

  // CORS preflight: respond immediately.
  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Static docs and spec.
  if (method === 'GET' && (url.pathname === '/docs' || url.pathname === '/docs/')) {
    const html = readDocsFile('index.html');
    if (html) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
  }
  if (method === 'GET' && (url.pathname === '/openapi.json' || url.pathname === '/docs/openapi.json')) {
    const spec = readDocsFile('openapi.json');
    if (spec) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(spec);
      return;
    }
  }
  if (method === 'GET' && (url.pathname === '/storefront' || url.pathname === '/techbookstore-shop.html')) {
    try {
      const storefront = fs.readFileSync(STOREFRONT_FILE, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(storefront);
      return;
    } catch (e) {
      // Continue to the normal 404 envelope if the adjacent storefront file
      // is not present in a copied or partial distribution.
    }
  }
  const coverMatch = url.pathname.match(/^\/book-covers\/(\d{3}\.webp)$/);
  if (method === 'GET' && coverMatch) {
    try {
      const image = fs.readFileSync(path.join(BOOK_COVERS_DIR, coverMatch[1]));
      res.writeHead(200, {
        'Content-Type': 'image/webp',
        'Content-Length': image.length,
        'Cache-Control': 'public, max-age=31536000, immutable',
      });
      res.end(image);
      return;
    } catch (e) {
      // Continue to the standard JSON 404 response for an absent cover.
    }
  }
  const brandAssetMatch = url.pathname.match(/^\/brand-assets\/(tbs-(?:brand|favicon)\.png)$/);
  if (method === 'GET' && brandAssetMatch) {
    try {
      const image = fs.readFileSync(path.join(BRAND_ASSETS_DIR, brandAssetMatch[1]));
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': image.length,
        'Cache-Control': 'public, max-age=31536000, immutable',
      });
      res.end(image);
      return;
    } catch (e) {
      // Continue to the standard JSON 404 response for an absent brand asset.
    }
  }
  if (method === 'GET' && url.pathname === '/') {
    res.writeHead(302, { Location: '/docs' });
    res.end();
    return;
  }

  let matched;
  try {
    matched = router.match(method, url.pathname);
  } catch (err) {
    if (err instanceof URIError) {
      sendError(res, new ApiError(400, 'BAD_REQUEST', 'The request path contains invalid URL encoding.'), requestId);
      return;
    }
    throw err;
  }

  // No such path at all -> 404.
  if (!matched) {
    sendError(res, new ApiError(404, 'NOT_FOUND', `No route for ${method} ${url.pathname}.`), requestId);
    return;
  }

  // Path exists but not for this method -> 405 with Allow header.
  if (!matched.handlers) {
    const allow = Array.from(matched.allowed).sort().join(', ');
    const err = new ApiError(405, 'METHOD_NOT_ALLOWED', `${method} is not allowed on ${url.pathname}.`);
    err.headers['Allow'] = allow;
    sendError(res, err, requestId);
    return;
  }

  try {
    // Parse the JSON body once, up front (throws 415/400 as needed).
    const body = await readJsonBody(req);
    const ctx = buildContext(req, res, url, body);
    ctx.params = matched.params;

    // Run the handler chain until one sends a response.
    for (const handler of matched.handlers) {
      // A handler "sends" by calling ctx.json / ctx.noContent, which sets
      // res.writableEnded. If that happened, stop the chain.
      // eslint-disable-next-line no-await-in-loop
      await handler(ctx);
      if (res.writableEnded) break;
    }

    // Safety net: if no handler responded, send 500.
    if (!res.writableEnded) {
      sendError(res, new ApiError(500, 'NO_RESPONSE', 'The route did not produce a response.'), requestId);
    }
  } catch (err) {
    if (!res.writableEnded) sendError(res, err, requestId);
  }
}

module.exports = { handleRequest, router };
