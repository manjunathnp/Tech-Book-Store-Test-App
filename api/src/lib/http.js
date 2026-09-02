'use strict';

/*
 * Thin helpers over Node's raw http request/response objects so route
 * handlers can stay small and readable. No framework, just a few functions.
 */

const { URL } = require('url');
const { BadRequestError, UnsupportedMediaTypeError, PayloadTooLargeError } = require('./errors');

const MAX_BODY_BYTES = 1_000_000; // 1 MB guard against runaway payloads

// Read and JSON-parse the request body. Resolves to {} for empty bodies.
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const method = req.method.toUpperCase();
    const expectsBody = method === 'POST' || method === 'PUT' || method === 'PATCH';

    let raw = '';
    let bytes = 0;
    let tooLarge = false;

    const declaredLength = Number.parseInt(req.headers['content-length'] || '0', 10);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      req.resume();
      reject(new PayloadTooLargeError(`Request body must not exceed ${MAX_BODY_BYTES} bytes.`));
      return;
    }

    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        tooLarge = true;
        raw = '';
        return;
      }
      if (!tooLarge) raw += chunk;
    });

    req.on('end', () => {
      if (tooLarge) {
        reject(new PayloadTooLargeError(`Request body must not exceed ${MAX_BODY_BYTES} bytes.`));
        return;
      }
      if (!raw || raw.trim() === '') {
        resolve({});
        return;
      }

      // If a body is present on a writing method, require JSON content type.
      if (expectsBody) {
        const contentType = (req.headers['content-type'] || '').toLowerCase();
        if (!contentType.includes('application/json')) {
          reject(new UnsupportedMediaTypeError());
          return;
        }
      }

      try {
        const parsed = JSON.parse(raw);
        assertJsonComplexity(parsed);
        resolve(parsed);
      } catch (e) {
        if (e instanceof BadRequestError) {
          reject(e);
          return;
        }
        reject(new BadRequestError('Request body is not valid JSON.'));
      }
    });

    req.on('error', (e) => reject(new BadRequestError('Failed to read request body.')));
  });
}

// Reject pathological JSON before route handlers or JSON.stringify recurse
// through it. The iterative walk itself cannot overflow the JavaScript stack.
function assertJsonComplexity(value) {
  const stack = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const current = stack.pop();
    nodes += 1;
    if (current.depth > 100) throw new BadRequestError('Request body is nested too deeply.');
    if (nodes > 100_000) throw new BadRequestError('Request body is too complex.');
    if (!current.value || typeof current.value !== 'object') continue;
    const children = Array.isArray(current.value) ? current.value : Object.values(current.value);
    for (const child of children) stack.push({ value: child, depth: current.depth + 1 });
  }
}

function parseUrl(req) {
  // Any base works; we only use pathname and searchParams.
  return new URL(req.url, 'http://localhost');
}

function sendJson(res, status, payload, extraHeaders) {
  const body = payload === undefined ? '' : JSON.stringify(payload);
  const headers = Object.assign(
    {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
    extraHeaders || {}
  );
  res.writeHead(status, headers);
  // 204 No Content and HEAD must not include a body.
  if (status === 204) {
    res.end();
  } else {
    res.end(body);
  }
}

function sendNoContent(res, extraHeaders) {
  const headers = Object.assign({ 'Cache-Control': 'no-store' }, extraHeaders || {});
  res.writeHead(204, headers);
  res.end();
}

module.exports = { readJsonBody, parseUrl, sendJson, sendNoContent, MAX_BODY_BYTES };
