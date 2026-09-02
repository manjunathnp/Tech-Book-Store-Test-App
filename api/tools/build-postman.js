'use strict';

/*
 * Generates a Postman v2.1 collection with real tests (pm.test) and request
 * chaining through collection variables. Written as a script so the output is
 * always valid JSON and easy to regenerate.
 *
 * Run: node tools/build-postman.js
 */

const fs = require('fs');
const path = require('path');

function t(lines) { return { listen: 'test', script: { type: 'text/javascript', exec: lines } }; }
function pre(lines) { return { listen: 'prerequest', script: { type: 'text/javascript', exec: lines } }; }

function url(raw) {
  // Build Postman url object from a path like '/api/books?limit=5'.
  const [p, q] = raw.split('?');
  const segments = p.replace(/^\//, '').split('/');
  const out = { raw: '{{baseUrl}}' + raw, host: ['{{baseUrl}}'], path: segments };
  if (q) {
    out.query = q.split('&').map((pair) => {
      const [key, value] = pair.split('=');
      return { key, value: value || '' };
    });
  }
  return out;
}

function req(name, method, rawUrl, opts = {}) {
  const request = { method, header: opts.headers || [], url: url(rawUrl) };
  if (opts.auth === 'admin') request.header.push({ key: 'Authorization', value: 'Bearer {{adminToken}}' });
  if (opts.auth === 'user') request.header.push({ key: 'Authorization', value: 'Bearer {{userToken}}' });
  if (opts.auth === 'shopper') request.header.push({ key: 'Authorization', value: 'Bearer {{shopperToken}}' });
  if (opts.body !== undefined) {
    request.header.push({ key: 'Content-Type', value: 'application/json' });
    request.body = { mode: 'raw', raw: JSON.stringify(opts.body, null, 2), options: { raw: { language: 'json' } } };
  }
  const item = { name, request };
  const events = [];
  if (opts.pre) events.push(pre(opts.pre));
  if (opts.test) events.push(t(opts.test));
  if (events.length) item.event = events;
  return item;
}

function folder(name, description, items) {
  return { name, description, item: items };
}

// Common test snippets
const statusIs = (code) => `pm.test("status is ${code}", function () { pm.response.to.have.status(${code}); });`;
const hasJson = 'pm.test("response is JSON", function () { pm.response.to.be.json; });';

const collection = {
  info: {
    _postman_id: 'techbookstore-practice-collection',
    name: 'Tech Book Store Practice API',
    description: 'A complete, tested collection for the Tech Book Store Practice API. '
      + 'Run the folders top to bottom: Setup resets data, Auth logs in and stores tokens, '
      + 'then every resource folder can run on its own. Advanced and Negative folders drill '
      + 'error handling, ETag concurrency, idempotency, and rate limiting.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  variable: [
    { key: 'baseUrl', value: 'http://127.0.0.1:3000' },
    { key: 'adminToken', value: '' },
    { key: 'userToken', value: '' },
    { key: 'shopperToken', value: '' },
    { key: 'refreshToken', value: '' },
    { key: 'newBookId', value: '' },
    { key: 'bookEtag', value: '' },
    { key: 'orderId', value: '' },
    { key: 'reviewId', value: '' },
    { key: 'apiKey', value: 'tbs_live_9c8b7a6d5e4f3210' },
  ],
  item: [],
};

// ---------- 00 Setup ----------
collection.item.push(folder('00 Setup', 'Reset data to a known state before running tests.', [
  req('Reset data', 'POST', '/api/reset', {
    test: [statusIs(200), 'pm.test("reset ok", function () { pm.expect(pm.response.json().ok).to.eql(true); });'],
  }),
]));

// ---------- 01 Health & Info ----------
collection.item.push(folder('01 Health and Info', 'Basic liveness and index checks.', [
  req('Health', 'GET', '/health', { test: [statusIs(200), 'pm.test("status ok", function(){ pm.expect(pm.response.json().status).to.eql("ok"); });'] }),
  req('API index', 'GET', '/api', { test: [statusIs(200), 'pm.test("has name", function(){ pm.expect(pm.response.json().name).to.be.a("string"); });'] }),
]));

// ---------- 02 Auth ----------
collection.item.push(folder('02 Auth', 'Register, login (admin/user/shopper), profile, refresh rotation, logout, API key and Basic auth.', [
  req('Register new user', 'POST', '/api/auth/register', {
    body: { name: 'Postman User', email: 'postman.user@test.io', password: 'secret123' },
    test: [
      'pm.test("status is 201 or 409", function(){ pm.expect([201,409]).to.include(pm.response.code); });',
      'if (pm.response.code === 201) { pm.test("role is user", function(){ pm.expect(pm.response.json().user.role).to.eql("user"); }); }',
    ],
  }),
  req('Login as admin', 'POST', '/api/auth/login', {
    body: { email: 'admin@bookstore.test', password: 'admin123' },
    test: [
      statusIs(200),
      'var d = pm.response.json();',
      'pm.test("returns access token", function(){ pm.expect(d.tokens.accessToken).to.be.a("string"); });',
      'pm.collectionVariables.set("adminToken", d.tokens.accessToken);',
    ],
  }),
  req('Login as user', 'POST', '/api/auth/login', {
    body: { email: 'user@bookstore.test', password: 'password123' },
    test: [
      statusIs(200),
      'var d = pm.response.json();',
      'pm.collectionVariables.set("userToken", d.tokens.accessToken);',
      'pm.collectionVariables.set("refreshToken", d.tokens.refreshToken);',
    ],
  }),
  req('Login as shopper (Sam)', 'POST', '/api/auth/login', {
    body: { email: 'sam@bookstore.test', password: 'password123' },
    test: [statusIs(200), 'pm.collectionVariables.set("shopperToken", pm.response.json().tokens.accessToken);'],
  }),
  req('Get current user (me)', 'GET', '/api/auth/me', { auth: 'user', test: [statusIs(200), 'pm.test("email matches", function(){ pm.expect(pm.response.json().email).to.eql("user@bookstore.test"); });'] }),
  req('Login with wrong password (401)', 'POST', '/api/auth/login', { body: { email: 'admin@bookstore.test', password: 'nope' }, test: [statusIs(401)] }),
  req('Refresh tokens (rotation)', 'POST', '/api/auth/refresh', {
    body: { refreshToken: '{{refreshToken}}' },
    test: [statusIs(200), 'var d = pm.response.json();', 'pm.collectionVariables.set("userToken", d.tokens.accessToken);', 'pm.collectionVariables.set("refreshToken", d.tokens.refreshToken);'],
  }),
  req('API key endpoint (200)', 'GET', '/api/auth/apikey', { headers: [{ key: 'X-API-Key', value: '{{apiKey}}' }], test: [statusIs(200), 'pm.test("authenticated", function(){ pm.expect(pm.response.json().authenticated).to.eql(true); });'] }),
  req('API key endpoint wrong key (401)', 'GET', '/api/auth/apikey', { headers: [{ key: 'X-API-Key', value: 'wrong' }], test: [statusIs(401)] }),
  req('Basic auth endpoint (200)', 'GET', '/api/auth/basic', { headers: [{ key: 'Authorization', value: 'Basic YmFzaWNfdXNlcjpiYXNpY19wYXNzXzEyMw==' }], test: [statusIs(200)] }),
]));

// ---------- 03 Books ----------
collection.item.push(folder('03 Books', 'CRUD plus pagination, filtering, sorting, search, sparse fields, ETag concurrency, soft delete and restore.', [
  req('List books', 'GET', '/api/books', { test: [statusIs(200), 'pm.test("has data array", function(){ pm.expect(pm.response.json().data).to.be.an("array"); });', 'pm.test("has meta.total", function(){ pm.expect(pm.response.json().meta.total).to.be.a("number"); });'] }),
  req('List books page 2 limit 5', 'GET', '/api/books?page=2&limit=5', { test: [statusIs(200), 'var m = pm.response.json().meta;', 'pm.test("page 2", function(){ pm.expect(m.page).to.eql(2); });', 'pm.test("limit 5", function(){ pm.expect(m.limit).to.eql(5); });'] }),
  req('Sort by price desc', 'GET', '/api/books?sort=price&order=desc&limit=100', { test: [statusIs(200), 'var p = pm.response.json().data.map(function(b){return b.price;});', 'pm.test("descending", function(){ for (var i=1;i<p.length;i++){ pm.expect(p[i-1]).to.be.at.least(p[i]); } });'] }),
  req('Search playwright', 'GET', '/api/books?search=playwright', { test: [statusIs(200), 'pm.test("has matches", function(){ pm.expect(pm.response.json().data.length).to.be.above(0); });'] }),
  req('Filter inStock and price range', 'GET', '/api/books?inStock=true&minPrice=20&maxPrice=45&limit=100', { test: [statusIs(200), 'pm.test("all match filter", function(){ pm.response.json().data.forEach(function(b){ pm.expect(b.inStock).to.eql(true); pm.expect(b.price).to.be.within(20,45); }); });'] }),
  req('Sparse fields id,title', 'GET', '/api/books?fields=id,title&limit=3', { test: [statusIs(200), 'pm.test("only id and title", function(){ pm.response.json().data.forEach(function(b){ pm.expect(Object.keys(b).sort().join(",")).to.eql("id,title"); }); });'] }),
  req('Get book 1 (capture ETag)', 'GET', '/api/books/1', { test: [statusIs(200), 'pm.test("id is 1", function(){ pm.expect(pm.response.json().id).to.eql(1); });', 'pm.collectionVariables.set("bookEtag", pm.response.headers.get("ETag"));', 'pm.test("has ETag", function(){ pm.expect(pm.response.headers.get("ETag")).to.be.a("string"); });'] }),
  req('Get missing book (404)', 'GET', '/api/books/99999', { test: [statusIs(404), 'pm.test("NOT_FOUND", function(){ pm.expect(pm.response.json().error.code).to.eql("NOT_FOUND"); });'] }),
  req('Create book without token (401)', 'POST', '/api/books', { body: { title: 'x', authorId: 1, categoryId: 1, price: 9.99 }, test: [statusIs(401)] }),
  req('Create book as user (403)', 'POST', '/api/books', { auth: 'user', body: { title: 'x', authorId: 1, categoryId: 1, price: 9.99 }, test: [statusIs(403)] }),
  req('Create book invalid (422)', 'POST', '/api/books', { auth: 'admin', body: { title: '', price: 'free' }, test: [statusIs(422), 'pm.test("has details", function(){ pm.expect(pm.response.json().error.details.length).to.be.above(0); });'] }),
  req('Create book (admin) -> capture id + ETag', 'POST', '/api/books', {
    auth: 'admin', body: { title: 'Postman Created Book', authorId: 1, categoryId: 1, price: 24.99, format: 'ebook' },
    test: [statusIs(201), 'var d = pm.response.json();', 'pm.collectionVariables.set("newBookId", d.id);', 'pm.collectionVariables.set("bookEtag", pm.response.headers.get("ETag"));', 'pm.test("has Location", function(){ pm.expect(pm.response.headers.get("Location")).to.be.a("string"); });'],
  }),
  req('Update with stale If-Match (412)', 'PATCH', '/api/books/{{newBookId}}', { auth: 'admin', headers: [{ key: 'If-Match', value: '"book-1-v1"' }], body: { price: 30 }, test: [statusIs(412)] }),
  req('Update with correct If-Match (200)', 'PATCH', '/api/books/{{newBookId}}', { auth: 'admin', headers: [{ key: 'If-Match', value: '{{bookEtag}}' }], body: { price: 30 }, test: [statusIs(200), 'pm.test("price updated", function(){ pm.expect(pm.response.json().price).to.eql(30); });', 'pm.collectionVariables.set("bookEtag", pm.response.headers.get("ETag"));'] }),
  req('Soft delete book (204)', 'DELETE', '/api/books/{{newBookId}}', { auth: 'admin', test: [statusIs(204)] }),
  req('Get soft-deleted book (410)', 'GET', '/api/books/{{newBookId}}', { test: [statusIs(410), 'pm.test("GONE", function(){ pm.expect(pm.response.json().error.code).to.eql("GONE"); });'] }),
  req('Restore book (200)', 'POST', '/api/books/{{newBookId}}/restore', { auth: 'admin', test: [statusIs(200), 'pm.test("not deleted", function(){ pm.expect(pm.response.json().deleted).to.eql(false); });'] }),
  req('Method not allowed on collection (405)', 'DELETE', '/api/books', { test: [statusIs(405), 'pm.test("has Allow header", function(){ pm.expect(pm.response.headers.get("Allow")).to.be.a("string"); });'] }),
]));

// ---------- 04 Authors / Categories / Publishers ----------
collection.item.push(folder('04 Authors, Categories, Publishers', 'Simple resources sharing the same CRUD behaviour.', [
  req('List authors', 'GET', '/api/authors', { test: [statusIs(200), 'pm.test("array", function(){ pm.expect(pm.response.json().data).to.be.an("array"); });'] }),
  req('Get author 1', 'GET', '/api/authors/1', { test: [statusIs(200)] }),
  req('Create author (admin)', 'POST', '/api/authors', { auth: 'admin', body: { name: 'Postman Author', bio: 'Created via Postman', country: 'IN' }, test: [statusIs(201)] }),
  req('List categories', 'GET', '/api/categories', { test: [statusIs(200)] }),
  req('List publishers', 'GET', '/api/publishers', { test: [statusIs(200)] }),
  req('Create category as user (403)', 'POST', '/api/categories', { auth: 'user', body: { name: 'Nope' }, test: [statusIs(403)] }),
]));

// ---------- 05 Reviews ----------
collection.item.push(folder('05 Reviews', 'Create a review under a book (chaining), enforce one-per-user, update and delete with ownership.', [
  req('Create review under book 45', 'POST', '/api/books/45/reviews', { auth: 'shopper', body: { rating: 5, title: 'Excellent', body: 'Very practical and clear.' }, test: ['pm.test("status 201 or 409", function(){ pm.expect([201,409]).to.include(pm.response.code); });', 'if (pm.response.code === 201) { pm.collectionVariables.set("reviewId", pm.response.json().id); }'] }),
  req('List reviews for book 45', 'GET', '/api/books/45/reviews', { test: [statusIs(200), 'pm.test("array", function(){ pm.expect(pm.response.json().data).to.be.an("array"); });'] }),
  req('Duplicate review (409)', 'POST', '/api/books/45/reviews', { auth: 'shopper', body: { rating: 3, title: 'Again', body: 'Second attempt.' }, test: [statusIs(409)] }),
  req('Update own review', 'PATCH', '/api/reviews/{{reviewId}}', { auth: 'shopper', body: { rating: 4 }, test: ['pm.test("status 200 or 404", function(){ pm.expect([200,404]).to.include(pm.response.code); });'] }),
]));

// ---------- 06 Cart & Wishlist ----------
collection.item.push(folder('06 Cart and Wishlist', 'Per-user cart and wishlist. Sets up the checkout chain in the Orders folder.', [
  req('Empty cart first', 'DELETE', '/api/cart', { auth: 'shopper', test: ['pm.test("204 or 200", function(){ pm.expect([204,200]).to.include(pm.response.code); });'] }),
  req('Add book 2 x2 to cart', 'POST', '/api/cart/items', { auth: 'shopper', body: { bookId: 2, quantity: 2 }, test: [statusIs(201), 'pm.test("item count 2", function(){ pm.expect(pm.response.json().itemCount).to.eql(2); });'] }),
  req('Add book 3 to cart', 'POST', '/api/cart/items', { auth: 'shopper', body: { bookId: 3, quantity: 1 }, test: [statusIs(201)] }),
  req('View cart', 'GET', '/api/cart', { auth: 'shopper', test: [statusIs(200), 'pm.test("subtotal > 0", function(){ pm.expect(pm.response.json().subtotal).to.be.above(0); });'] }),
  req('Update cart item quantity', 'PATCH', '/api/cart/items/2', { auth: 'shopper', body: { quantity: 3 }, test: [statusIs(200)] }),
  req('Add to wishlist', 'POST', '/api/wishlist/items', { auth: 'shopper', body: { bookId: 9 }, test: ['pm.test("201 or 409", function(){ pm.expect([201,409]).to.include(pm.response.code); });'] }),
  req('View wishlist', 'GET', '/api/wishlist', { auth: 'shopper', test: [statusIs(200)] }),
]));

// ---------- 07 Orders ----------
collection.item.push(folder('07 Orders', 'Checkout from cart with an idempotency key, verify replay returns the same order, then cancel.', [
  req('Checkout (create order) with Idempotency-Key', 'POST', '/api/orders', {
    auth: 'shopper', headers: [{ key: 'Idempotency-Key', value: 'postman-checkout-1' }], body: { shippingAddress: '1 Test Street, Bengaluru' },
    test: ['pm.test("201 or 200", function(){ pm.expect([201,200]).to.include(pm.response.code); });', 'pm.collectionVariables.set("orderId", pm.response.json().id);', 'pm.test("status pending", function(){ pm.expect(pm.response.json().status).to.eql("pending"); });'],
  }),
  req('Replay checkout (same key -> same order)', 'POST', '/api/orders', {
    auth: 'shopper', headers: [{ key: 'Idempotency-Key', value: 'postman-checkout-1' }], body: {},
    test: ['pm.test("same order id", function(){ pm.expect(pm.response.json().id).to.eql(Number(pm.collectionVariables.get("orderId"))); });'],
  }),
  req('Get order', 'GET', '/api/orders/{{orderId}}', { auth: 'shopper', test: [statusIs(200)] }),
  req('List my orders', 'GET', '/api/orders', { auth: 'shopper', test: [statusIs(200), 'pm.test("array", function(){ pm.expect(pm.response.json().data).to.be.an("array"); });'] }),
  req('Another user cannot view my order (403)', 'GET', '/api/orders/{{orderId}}', { auth: 'user', test: [statusIs(403)] }),
  req('Cancel order', 'POST', '/api/orders/{{orderId}}/cancel', { auth: 'shopper', test: [statusIs(200), 'pm.test("cancelled", function(){ pm.expect(pm.response.json().status).to.eql("cancelled"); });'] }),
  req('Cancel again (409)', 'POST', '/api/orders/{{orderId}}/cancel', { auth: 'shopper', test: [statusIs(409)] }),
  req('Checkout empty cart (409)', 'POST', '/api/orders', { auth: 'shopper', body: {}, test: [statusIs(409)] }),
]));

// ---------- 08 Negative & Status codes ----------
collection.item.push(folder('08 Negative and Status Codes', 'Deliberately trigger each error status for practice.', [
  req('415 wrong content type', 'POST', '/api/echo', { headers: [{ key: 'Content-Type', value: 'text/plain' }], test: ['pm.test("415", function(){ pm.expect(pm.response.code).to.eql(415); });'], }),
  req('400 bad JSON body', 'POST', '/api/echo', { headers: [{ key: 'Content-Type', value: 'application/json' }], test: [statusIs(400)] }),
  req('Status generator 418', 'GET', '/api/status/418', { test: [statusIs(418)] }),
  req('Status generator 503', 'GET', '/api/status/503', { test: [statusIs(503)] }),
  req('Status generator 204', 'GET', '/api/status/204', { test: [statusIs(204)] }),
]));
// Fix the 400 bad JSON body request: send invalid JSON raw.
(function () {
  const neg = collection.item[collection.item.length - 1];
  const badJson = neg.item[1];
  badJson.request.body = { mode: 'raw', raw: '{ not valid json ', options: { raw: { language: 'json' } } };
}());
// Fix 415 request: send a raw text body with text/plain.
(function () {
  const neg = collection.item[collection.item.length - 1];
  const wrongCt = neg.item[0];
  wrongCt.request.body = { mode: 'raw', raw: 'hello', options: { raw: { language: 'text' } } };
}());

// ---------- 09 Advanced ----------
collection.item.push(folder('09 Advanced', 'Rate limiting (429), artificial delay, and a fresh ETag concurrency walk-through.', [
  req('Delay 800ms', 'GET', '/api/delay?ms=800', { test: [statusIs(200), 'pm.test("waited", function(){ pm.expect(pm.response.responseTime).to.be.above(700); });'] }),
  req('Rate limit hit 1', 'GET', '/api/limited', { test: ['pm.test("200 or 429", function(){ pm.expect([200,429]).to.include(pm.response.code); });'] }),
  req('Rate limit hit 2', 'GET', '/api/limited', { test: ['pm.test("200 or 429", function(){ pm.expect([200,429]).to.include(pm.response.code); });'] }),
  req('Rate limit hit 3', 'GET', '/api/limited', { test: ['pm.test("200 or 429", function(){ pm.expect([200,429]).to.include(pm.response.code); });'] }),
  req('Rate limit hit 4 (likely 429)', 'GET', '/api/limited', { test: ['pm.test("200 or 429", function(){ pm.expect([200,429]).to.include(pm.response.code); });', 'if (pm.response.code === 429) { pm.test("Retry-After present", function(){ pm.expect(pm.response.headers.get("Retry-After")).to.be.a("string"); }); }'] }),
  req('Rate limit hit 5 (likely 429)', 'GET', '/api/limited', { test: ['pm.test("200 or 429", function(){ pm.expect([200,429]).to.include(pm.response.code); });'] }),
  req('Rate limit hit 6 (likely 429)', 'GET', '/api/limited', { test: ['pm.test("200 or 429", function(){ pm.expect([200,429]).to.include(pm.response.code); });'] }),
]));

const outPath = path.join(__dirname, '..', 'postman', 'TechBookStore.postman_collection.json');
fs.writeFileSync(outPath, JSON.stringify(collection, null, 2));

// Environment file
const env = {
  id: 'techbookstore-local-env',
  name: 'Tech Book Store (Local)',
  values: [
    { key: 'baseUrl', value: 'http://127.0.0.1:3000', enabled: true },
    { key: 'apiKey', value: 'tbs_live_9c8b7a6d5e4f3210', enabled: true },
  ],
  _postman_variable_scope: 'environment',
};
fs.writeFileSync(path.join(__dirname, '..', 'postman', 'TechBookStore.postman_environment.json'), JSON.stringify(env, null, 2));

let count = 0;
collection.item.forEach((f) => { count += f.item.length; });
// eslint-disable-next-line no-console
console.log(`Wrote Postman collection: ${collection.item.length} folders, ${count} requests.`);
