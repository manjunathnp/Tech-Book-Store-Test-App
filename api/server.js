'use strict';

/*
 * Tech Book Store Practice API - entry point.
 *
 * Run it with:   node server.js
 * No install, no build, no external services. Node 18+ only.
 *
 * Environment variables (all optional):
 *   PORT, HOST, JWT_SECRET, ACCESS_TOKEN_TTL, REFRESH_TOKEN_TTL,
 *   API_KEY, BASIC_USER, BASIC_PASS, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS,
 *   CHATBOT_ENABLED, OLLAMA_URL, CHATBOT_MODEL, CHATBOT_TOOL_MODE, CHATBOT_THINK, CHATBOT_CONTEXT_TOKENS,
 *   LOG_REQUESTS=false to silence request logging.
 */

const http = require('http');
const config = require('./src/config');
const store = require('./src/store');
const { handleRequest } = require('./src/app');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
if (!LOOPBACK_HOSTS.has(config.host) && !config.allowInsecurePublicDemo) {
  throw new Error('Refusing non-loopback HOST because this practice app exposes seeded credentials. Set ALLOW_INSECURE_PUBLIC_DEMO=true only for an intentionally public demo.');
}

// Seed the data once at boot.
store.init();

const server = http.createServer((req, res) => {
  const start = Date.now();

  // Lightweight request logging.
  if (config.logRequests) {
    res.on('finish', () => {
      const ms = Date.now() - start;
      // eslint-disable-next-line no-console
      console.log(`${req.method} ${req.url} -> ${res.statusCode} (${ms}ms)`);
    });
  }

  handleRequest(req, res).catch((err) => {
    // Absolute last-resort guard so the process never crashes on a bad request.
    // eslint-disable-next-line no-console
    console.error('Fatal request error:', err);
    if (!res.writableEnded) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected error.' } }));
    }
  });
});

// Node can reject an oversized request line before the application router sees
// it. Return a controlled JSON 431 response instead of an empty socket error.
server.on('clientError', (err, socket) => {
  if (!socket.writable) return;
  const status = err && err.code === 'HPE_HEADER_OVERFLOW' ? 431 : 400;
  const code = status === 431 ? 'REQUEST_HEADER_FIELDS_TOO_LARGE' : 'BAD_REQUEST';
  const message = status === 431 ? 'The request target or headers are too large.' : 'The HTTP request is malformed.';
  const body = JSON.stringify({ error: { code, message } });
  socket.end(`HTTP/1.1 ${status} ${status === 431 ? 'Request Header Fields Too Large' : 'Bad Request'}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\n\r\n${body}`);
});

server.listen(config.port, config.host, () => {
  /* eslint-disable no-console */
  console.log('');
  console.log('  Tech Book Store Practice API');
  console.log('  ----------------------------');
  console.log(`  Base URL   : http://${config.host}:${config.port}`);
  console.log(`  Storefront : http://${config.host}:${config.port}/techbookstore-shop.html`);
  console.log(`  API docs   : http://${config.host}:${config.port}/docs`);
  console.log(`  OpenAPI    : http://${config.host}:${config.port}/openapi.json`);
  console.log(`  Health     : http://${config.host}:${config.port}/health`);
  console.log('');
  console.log('  Seeded accounts:');
  console.log('    admin@bookstore.test / admin123      (role: admin)');
  console.log('    user@bookstore.test  / password123   (role: user)');
  console.log('');
  console.log('  Reset data : POST /api/reset');
  console.log('  Stop server: Ctrl + C');
  console.log('');
  /* eslint-enable no-console */
});

// Graceful shutdown.
process.on('SIGINT', () => {
  // eslint-disable-next-line no-console
  console.log('\nShutting down...');
  server.close(() => process.exit(0));
});

module.exports = server;
