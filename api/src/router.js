'use strict';

/*
 * A tiny router. Routes are registered as (method, pattern, ...handlers).
 * Patterns use :name segments, for example '/api/books/:id'.
 *
 * Each handler is an async function receiving a single `ctx` (context) object.
 * A handler may:
 *   - read ctx.params, ctx.query, ctx.body, ctx.user
 *   - send a response with ctx.json(...) / ctx.noContent()
 *   - throw an ApiError (the central error handler formats it)
 *   - return without sending to let the next handler run (middleware style)
 *
 * The first handler that sends a response ends the chain.
 */

class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, ...handlers) {
    const keys = [];
    const regexSource = pattern
      .split('/')
      .map((segment) => {
        if (segment.startsWith(':')) {
          keys.push(segment.slice(1));
          return '([^/]+)';
        }
        // Escape regex-special characters in literal segments.
        return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    const regex = new RegExp('^' + regexSource + '/?$');
    this.routes.push({ method: method.toUpperCase(), regex, keys, handlers });
    return this;
  }

  get(p, ...h) { return this.add('GET', p, ...h); }
  post(p, ...h) { return this.add('POST', p, ...h); }
  put(p, ...h) { return this.add('PUT', p, ...h); }
  patch(p, ...h) { return this.add('PATCH', p, ...h); }
  delete(p, ...h) { return this.add('DELETE', p, ...h); }
  head(p, ...h) { return this.add('HEAD', p, ...h); }
  options(p, ...h) { return this.add('OPTIONS', p, ...h); }

  // Find a route for a method + pathname. Returns { handlers, params } or null.
  // Also reports whether the path exists under other methods, so we can answer
  // 405 Method Not Allowed with a correct Allow header.
  match(method, pathname) {
    const allowed = new Set();
    for (const route of this.routes) {
      const m = route.regex.exec(pathname);
      if (!m) continue;
      allowed.add(route.method);
      if (route.method === method.toUpperCase()) {
        const params = {};
        route.keys.forEach((key, i) => {
          params[key] = decodeURIComponent(m[i + 1]);
        });
        return { handlers: route.handlers, params, allowed };
      }
    }
    return allowed.size > 0 ? { handlers: null, params: {}, allowed } : null;
  }
}

module.exports = { Router };
