'use strict';

/*
 * System endpoints: health checks, an API index, and the all-important reset.
 *
 *   GET  /health         -> liveness probe (also at /api/health)
 *   GET  /api            -> quick index of the API
 *   POST /api/reset      -> restore the pristine seed data (repeatable tests!)
 *
 * POST /api/reset is what makes automated suites reliable: call it in a global
 * setup (or beforeAll) and every run starts from identical data.
 */

const store = require('../store');
const { resetIdempotency } = require('./orders.routes');
const { resetChatState } = require('./chat.routes');
const rateLimit = require('../middleware/rateLimit');

const startedAt = Date.now();

function registerSystemRoutes(router) {
  const health = (ctx) => {
    ctx.json(200, {
      status: 'ok',
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      timestamp: new Date().toISOString(),
    });
  };
  router.get('/health', health);
  router.get('/api/health', health);

  router.get('/api', (ctx) => {
    ctx.json(200, {
      name: 'Tech Book Store Practice API',
      version: '1.0.0',
      description: 'A zero-dependency API for practising API test automation with Playwright.',
      docs: '/docs',
      storefront: '/techbookstore-shop.html',
      openapi: '/openapi.json',
      resources: [
        '/api/books', '/api/authors', '/api/categories', '/api/publishers',
        '/api/users', '/api/reviews', '/api/cart', '/api/wishlist', '/api/orders',
        '/api/chat',
      ],
      auth: [
        'POST /api/auth/register', 'POST /api/auth/login', 'POST /api/auth/refresh',
        'POST /api/auth/logout', 'GET /api/auth/me',
        'GET /api/auth/apikey', 'GET /api/auth/basic',
      ],
      practice: ['GET /api/limited', 'GET /api/delay', 'GET /api/status/:code', '/api/echo'],
      reset: 'POST /api/reset',
    });
  });

  // RESET (open, so tests can call it freely in local practice)
  router.post('/api/reset', (ctx) => {
    store.reset();
    resetIdempotency();
    resetChatState();
    rateLimit.reset();
    ctx.json(200, { message: 'Data has been reset to the original seed.', ok: true });
  });
}

module.exports = { registerSystemRoutes };
