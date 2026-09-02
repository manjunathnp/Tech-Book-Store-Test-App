'use strict';

/*
 * Standalone practice endpoints. Each one isolates a single concept so a
 * learner can drill it without any other moving parts.
 *
 *   GET /api/auth/apikey   -> requires header  X-API-Key: <key>
 *   GET /api/auth/basic    -> requires HTTP Basic auth (Authorization: Basic ..)
 *   GET /api/limited       -> rate limited; returns 429 after the limit
 *   GET /api/delay?ms=1500 -> waits before responding (timeout practice)
 *   ANY /api/echo          -> echoes method, headers, query and body back
 *   GET /api/status/:code  -> responds with a final status code from 200-599
 */

const config = require('../config');
const { rateLimit } = require('../middleware/rateLimit');
const { UnauthorizedError, BadRequestError, ApiError } = require('../lib/errors');

function registerPracticeRoutes(router) {
  // ----- API key auth -----
  router.get('/api/auth/apikey', (ctx) => {
    const provided = ctx.req.headers['x-api-key'];
    if (!provided) {
      throw new UnauthorizedError('Missing X-API-Key header.');
    }
    if (provided !== config.apiKey) {
      throw new UnauthorizedError('Invalid API key.');
    }
    ctx.json(200, { message: 'API key accepted.', authenticated: true, method: 'api-key' });
  });

  // ----- HTTP Basic auth -----
  router.get('/api/auth/basic', (ctx) => {
    const header = ctx.req.headers['authorization'] || '';
    if (!header.startsWith('Basic ')) {
      const err = new UnauthorizedError('Missing HTTP Basic credentials.');
      err.headers['WWW-Authenticate'] = 'Basic realm="TechBookStore"';
      throw err;
    }
    let decoded = '';
    try {
      decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
    } catch (e) {
      throw new UnauthorizedError('Basic credentials are not valid base64.');
    }
    const sep = decoded.indexOf(':');
    const user = sep === -1 ? decoded : decoded.slice(0, sep);
    const pass = sep === -1 ? '' : decoded.slice(sep + 1);
    if (user !== config.basicAuthUser || pass !== config.basicAuthPass) {
      const err = new UnauthorizedError('Invalid Basic credentials.');
      err.headers['WWW-Authenticate'] = 'Basic realm="TechBookStore"';
      throw err;
    }
    ctx.json(200, { message: 'Basic auth accepted.', authenticated: true, user });
  });

  // ----- Rate limited -----
  router.get('/api/limited', rateLimit, (ctx) => {
    ctx.json(200, { message: 'Request accepted (within the rate limit).' });
  });

  // ----- Artificial delay (timeout / waiting practice) -----
  router.get('/api/delay', async (ctx) => {
    let ms = Number.parseInt(ctx.url.searchParams.get('ms') || '1000', 10);
    if (!Number.isFinite(ms) || ms < 0) ms = 0;
    if (ms > 10000) ms = 10000; // safety cap at 10s
    await new Promise((resolve) => setTimeout(resolve, ms));
    ctx.json(200, { message: `Responded after ${ms} ms.`, delayMs: ms });
  });

  // ----- Echo -----
  const echoHandler = (ctx) => {
    const query = {};
    for (const [k, v] of ctx.url.searchParams.entries()) query[k] = v;
    ctx.json(200, {
      method: ctx.req.method,
      path: ctx.url.pathname,
      headers: ctx.req.headers,
      query,
      body: ctx.body,
    });
  };
  router.get('/api/echo', echoHandler);
  router.post('/api/echo', echoHandler);
  router.put('/api/echo', echoHandler);
  router.patch('/api/echo', echoHandler);
  router.delete('/api/echo', echoHandler);

  // ----- Arbitrary status code -----
  router.get('/api/status/:code', (ctx) => {
    const code = Number.parseInt(ctx.params.code, 10);
    if (!Number.isFinite(code) || code < 200 || code > 599) {
      throw new BadRequestError('Status code must be between 200 and 599. Informational 1xx responses cannot be used as a final HTTP response.');
    }
    if (code >= 400) {
      // Return it as a proper error envelope.
      throw new ApiError(code, 'REQUESTED_STATUS', `You requested HTTP ${code}.`);
    }
    ctx.json(code === 204 ? 204 : code, code === 204 ? undefined : { requestedStatus: code, message: `Here is your ${code}.` });
  });
}

module.exports = { registerPracticeRoutes };
