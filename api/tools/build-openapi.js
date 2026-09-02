'use strict';

/*
 * Generates docs/openapi.json: a complete OpenAPI 3.0 description of the API.
 * Keeping this as a script (rather than a giant hand-typed JSON file) means
 * the spec stays consistent and is trivial to regenerate.
 *
 * Run: node tools/build-openapi.js
 */

const fs = require('fs');
const path = require('path');

const server = { url: 'http://127.0.0.1:3000', description: 'Local practice server' };

// ---------- Reusable schema fragments ----------
const schemas = {
  Error: {
    type: 'object',
    properties: {
      error: {
        type: 'object',
        properties: {
          code: { type: 'string', example: 'NOT_FOUND' },
          message: { type: 'string', example: 'Book 999 was not found.' },
          details: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                field: { type: 'string' },
                message: { type: 'string' },
                code: { type: 'string' },
              },
            },
          },
        },
        required: ['code', 'message'],
      },
    },
  },
  PageMeta: {
    type: 'object',
    properties: {
      page: { type: 'integer', example: 1 },
      limit: { type: 'integer', example: 10 },
      total: { type: 'integer', example: 60 },
      totalPages: { type: 'integer', example: 6 },
      hasNextPage: { type: 'boolean' },
      hasPrevPage: { type: 'boolean' },
    },
  },
  Book: {
    type: 'object',
    properties: {
      id: { type: 'integer', example: 1 },
      uuid: { type: 'string' },
      title: { type: 'string', example: 'Playwright End to End Testing' },
      isbn: { type: 'string' },
      authorId: { type: 'integer', example: 1 },
      categoryId: { type: 'integer', example: 1 },
      publisherId: { type: 'integer', nullable: true },
      price: { type: 'number', example: 19.99 },
      currency: { type: 'string', example: 'USD' },
      pages: { type: 'integer', nullable: true },
      rating: { type: 'number' },
      inStock: { type: 'boolean' },
      stockCount: { type: 'integer' },
      publishedYear: { type: 'integer' },
      language: { type: 'string' },
      format: { type: 'string', enum: ['paperback', 'ebook', 'hardcover'] },
      tags: { type: 'array', items: { type: 'string' } },
      description: { type: 'string' },
      version: { type: 'integer', description: 'Bumped on every write; drives the ETag.' },
      deleted: { type: 'boolean' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  BookCreate: {
    type: 'object',
    required: ['title', 'authorId', 'categoryId', 'price'],
    properties: {
      title: { type: 'string', example: 'A Brand New Test Book' },
      authorId: { type: 'integer', example: 1 },
      categoryId: { type: 'integer', example: 1 },
      publisherId: { type: 'integer', example: 1 },
      price: { type: 'number', example: 24.99 },
      pages: { type: 'integer', example: 320 },
      publishedYear: { type: 'integer', example: 2024 },
      inStock: { type: 'boolean', example: true },
      stockCount: { type: 'integer', example: 25 },
      format: { type: 'string', enum: ['paperback', 'ebook', 'hardcover'], example: 'ebook' },
      description: { type: 'string' },
    },
  },
  Author: {
    type: 'object',
    properties: {
      id: { type: 'integer' }, uuid: { type: 'string' }, name: { type: 'string' },
      bio: { type: 'string' }, country: { type: 'string' },
      createdAt: { type: 'string' }, updatedAt: { type: 'string' },
    },
  },
  Category: {
    type: 'object',
    properties: {
      id: { type: 'integer' }, uuid: { type: 'string' }, name: { type: 'string' },
      slug: { type: 'string' }, description: { type: 'string' },
      createdAt: { type: 'string' }, updatedAt: { type: 'string' },
    },
  },
  Publisher: {
    type: 'object',
    properties: {
      id: { type: 'integer' }, uuid: { type: 'string' }, name: { type: 'string' },
      city: { type: 'string' }, foundedYear: { type: 'integer', nullable: true },
      createdAt: { type: 'string' }, updatedAt: { type: 'string' },
    },
  },
  User: {
    type: 'object',
    properties: {
      id: { type: 'integer' }, uuid: { type: 'string' }, name: { type: 'string' },
      email: { type: 'string' }, role: { type: 'string', enum: ['admin', 'user'] },
      createdAt: { type: 'string' }, updatedAt: { type: 'string' },
    },
  },
  Review: {
    type: 'object',
    properties: {
      id: { type: 'integer' }, uuid: { type: 'string' }, bookId: { type: 'integer' },
      userId: { type: 'integer' }, rating: { type: 'integer' }, title: { type: 'string' },
      body: { type: 'string' }, createdAt: { type: 'string' }, updatedAt: { type: 'string' },
    },
  },
  Cart: {
    type: 'object',
    properties: {
      userId: { type: 'integer' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            bookId: { type: 'integer' }, title: { type: 'string' },
            unitPrice: { type: 'number' }, quantity: { type: 'integer' }, lineTotal: { type: 'number' },
          },
        },
      },
      itemCount: { type: 'integer' }, subtotal: { type: 'number' }, currency: { type: 'string' },
    },
  },
  Order: {
    type: 'object',
    properties: {
      id: { type: 'integer' }, uuid: { type: 'string' }, userId: { type: 'integer' },
      items: { type: 'array', items: { type: 'object' } },
      itemCount: { type: 'integer' }, subtotal: { type: 'number' }, currency: { type: 'string' },
      status: { type: 'string', enum: ['pending', 'cancelled'] },
      shippingAddress: { type: 'string' },
      createdAt: { type: 'string' }, updatedAt: { type: 'string' },
    },
  },
  Tokens: {
    type: 'object',
    properties: {
      accessToken: { type: 'string' }, refreshToken: { type: 'string' },
      tokenType: { type: 'string', example: 'Bearer' }, expiresIn: { type: 'integer', example: 900 },
    },
  },
  AuthResponse: {
    type: 'object',
    properties: {
      user: { $ref: '#/components/schemas/User' },
      tokens: { $ref: '#/components/schemas/Tokens' },
    },
  },
  ChatStatus: {
    type: 'object',
    required: ['provider', 'requiresApiKey', 'online', 'modelInstalled', 'configured'],
    properties: {
      provider: { type: 'string', example: 'ollama-local' },
      requiresApiKey: { type: 'boolean', example: false },
      model: { type: 'string', nullable: true, example: 'gemma3:4b' },
      online: { type: 'boolean' },
      modelInstalled: { type: 'boolean' },
      configured: { type: 'boolean' },
    },
  },
  ChatResponse: {
    type: 'object',
    required: ['sessionId', 'message', 'configured', 'local'],
    properties: {
      sessionId: { type: 'string' },
      message: { type: 'string', example: 'Just configure to use.' },
      configured: { type: 'boolean' },
      local: { type: 'boolean', example: true },
      model: { type: 'string', nullable: true },
    },
  },
};

// ---------- Reusable responses ----------
function jsonRef(ref) { return { 'application/json': { schema: { $ref: ref } } }; }
function errorResponse(desc) { return { description: desc, content: jsonRef('#/components/schemas/Error') }; }

const commonErrors = {
  401: errorResponse('Unauthorized (missing, invalid, expired, or logged-out token).'),
  403: errorResponse('Forbidden (authenticated but not allowed).'),
  404: errorResponse('Resource not found.'),
  422: errorResponse('Validation failed. See error.details for the offending fields.'),
};

function listResponse(itemRef) {
  return {
    description: 'A paginated list.',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            data: { type: 'array', items: { $ref: itemRef } },
            meta: { $ref: '#/components/schemas/PageMeta' },
          },
        },
      },
    },
  };
}

// Standard list query params.
const listParams = [
  { name: 'page', in: 'query', schema: { type: 'integer', default: 1 }, description: 'Page number (1-based).' },
  { name: 'limit', in: 'query', schema: { type: 'integer', default: 10 }, description: 'Items per page (max 100).' },
  { name: 'sort', in: 'query', schema: { type: 'string' }, description: 'Field to sort by, for example "price".' },
  { name: 'order', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'], default: 'asc' } },
  { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Free-text search.' },
  { name: 'fields', in: 'query', schema: { type: 'string' }, description: 'Comma-separated fields to return.' },
];

const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'integer' } };

// ---------- Helper to build a standard CRUD path set ----------
function crudPaths(base, tag, schemaName, createName, extraListParams = []) {
  const single = `#/components/schemas/${schemaName}`;
  const paths = {};
  paths[base] = {
    get: {
      tags: [tag], summary: `List ${tag.toLowerCase()}`, parameters: [...listParams, ...extraListParams],
      responses: { 200: listResponse(single) },
    },
    post: {
      tags: [tag], summary: `Create a ${schemaName.toLowerCase()} (admin)`,
      security: [{ bearerAuth: [] }],
      requestBody: { required: true, content: jsonRef(`#/components/schemas/${createName}`) },
      responses: {
        201: { description: 'Created.', content: jsonRef(single) },
        401: commonErrors[401], 403: commonErrors[403], 422: commonErrors[422],
      },
    },
  };
  paths[`${base}/{id}`] = {
    get: {
      tags: [tag], summary: `Get one ${schemaName.toLowerCase()}`, parameters: [idParam],
      responses: { 200: { description: 'Found.', content: jsonRef(single) }, 404: commonErrors[404] },
    },
    put: {
      tags: [tag], summary: `Replace a ${schemaName.toLowerCase()} (admin)`, parameters: [idParam],
      security: [{ bearerAuth: [] }],
      requestBody: { required: true, content: jsonRef(`#/components/schemas/${createName}`) },
      responses: { 200: { description: 'Updated.', content: jsonRef(single) }, 401: commonErrors[401], 403: commonErrors[403], 404: commonErrors[404], 422: commonErrors[422] },
    },
    patch: {
      tags: [tag], summary: `Update a ${schemaName.toLowerCase()} (admin)`, parameters: [idParam],
      security: [{ bearerAuth: [] }],
      requestBody: { required: true, content: jsonRef(`#/components/schemas/${createName}`) },
      responses: { 200: { description: 'Updated.', content: jsonRef(single) }, 401: commonErrors[401], 403: commonErrors[403], 404: commonErrors[404], 422: commonErrors[422] },
    },
    delete: {
      tags: [tag], summary: `Delete a ${schemaName.toLowerCase()} (admin)`, parameters: [idParam],
      security: [{ bearerAuth: [] }],
      responses: { 204: { description: 'Deleted.' }, 401: commonErrors[401], 403: commonErrors[403], 404: commonErrors[404] },
    },
  };
  return paths;
}

// ---------- Assemble paths ----------
const paths = {};

// System
paths['/health'] = { get: { tags: ['System'], summary: 'Liveness check', responses: { 200: { description: 'OK.' } } } };
paths['/api/health'] = { get: { tags: ['System'], summary: 'Liveness check (API-prefixed alias)', responses: { 200: { description: 'OK.' } } } };
paths['/api'] = { get: { tags: ['System'], summary: 'API index', responses: { 200: { description: 'OK.' } } } };
paths['/api/reset'] = {
  post: {
    tags: ['System'], summary: 'Reset all data to the original seed',
    description: 'Restores the pristine seed data and clears tokens, rate-limit counters, and idempotency keys. Call this before a test run for repeatable results.',
    responses: { 200: { description: 'Reset done.' } },
  },
};

// Auth
paths['/api/auth/register'] = {
  post: {
    tags: ['Auth'], summary: 'Register a new user (role: user)',
    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name', 'email', 'password'], properties: { name: { type: 'string' }, email: { type: 'string' }, password: { type: 'string', minLength: 6 } } } } } },
    responses: { 201: { description: 'Created.', content: jsonRef('#/components/schemas/AuthResponse') }, 409: errorResponse('Email already in use.'), 422: commonErrors[422] },
  },
};
paths['/api/auth/login'] = {
  post: {
    tags: ['Auth'], summary: 'Log in with email and password',
    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', example: 'admin@bookstore.test' }, password: { type: 'string', example: 'admin123' } } } } } },
    responses: { 200: { description: 'Logged in.', content: jsonRef('#/components/schemas/AuthResponse') }, 401: errorResponse('Invalid email or password.'), 422: commonErrors[422], 429: errorResponse('Too many login attempts. See Retry-After.') },
  },
};
paths['/api/auth/refresh'] = {
  post: {
    tags: ['Auth'], summary: 'Rotate tokens using a refresh token',
    description: 'Consumes the given refresh token and returns a brand-new access + refresh pair. The old refresh token stops working (rotation).',
    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['refreshToken'], properties: { refreshToken: { type: 'string' } } } } } },
    responses: { 200: { description: 'New tokens.', content: jsonRef('#/components/schemas/AuthResponse') }, 400: errorResponse('refreshToken missing.'), 401: errorResponse('Refresh token invalid, expired, or already used.') },
  },
};
paths['/api/auth/logout'] = {
  post: { tags: ['Auth'], summary: 'Log out all active sessions for the current user', security: [{ bearerAuth: [] }], responses: { 200: { description: 'All access and refresh tokens for the user were revoked.' }, 401: commonErrors[401] } },
};
paths['/api/auth/me'] = {
  get: { tags: ['Auth'], summary: 'Get the current user', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Current user.', content: jsonRef('#/components/schemas/User') }, 401: commonErrors[401] } },
};
paths['/api/auth/apikey'] = {
  get: { tags: ['Auth'], summary: 'API key protected endpoint', security: [{ apiKeyAuth: [] }], responses: { 200: { description: 'Key accepted.' }, 401: errorResponse('Missing or invalid API key.') } },
};
paths['/api/auth/basic'] = {
  get: { tags: ['Auth'], summary: 'HTTP Basic protected endpoint', security: [{ basicAuth: [] }], responses: { 200: { description: 'Basic auth accepted.' }, 401: errorResponse('Missing or invalid Basic credentials.') } },
};

// Books (custom, with ETag + soft delete + nested reviews)
Object.assign(paths, crudPaths('/api/books', 'Books', 'Book', 'BookCreate', [
  { name: 'inStock', in: 'query', schema: { type: 'boolean' }, description: 'Filter by stock availability.' },
  { name: 'minPrice', in: 'query', schema: { type: 'number' }, description: 'Minimum price.' },
  { name: 'maxPrice', in: 'query', schema: { type: 'number' }, description: 'Maximum price.' },
  { name: 'includeDeleted', in: 'query', schema: { type: 'boolean' }, description: 'Include soft-deleted books.' },
]));
// Enrich book get/put/patch with ETag semantics.
paths['/api/books/{id}'].get.responses[200].headers = { ETag: { schema: { type: 'string' }, description: 'Version tag for optimistic concurrency.' } };
paths['/api/books/{id}'].get.responses[410] = errorResponse('The book was soft-deleted.');
paths['/api/books/{id}'].put.parameters = [idParam, { name: 'If-Match', in: 'header', schema: { type: 'string' }, description: 'Optional ETag for optimistic concurrency; mismatch returns 412.' }];
paths['/api/books/{id}'].patch.parameters = paths['/api/books/{id}'].put.parameters;
paths['/api/books/{id}'].put.responses[412] = errorResponse('If-Match did not match the current ETag.');
paths['/api/books/{id}'].patch.responses[412] = errorResponse('If-Match did not match the current ETag.');
paths['/api/books/{id}/reviews'] = {
  get: { tags: ['Reviews'], summary: 'List reviews for a book', parameters: [idParam, ...listParams], responses: { 200: listResponse('#/components/schemas/Review'), 404: commonErrors[404] } },
  post: {
    tags: ['Reviews'], summary: 'Create a review for a book', parameters: [idParam], security: [{ bearerAuth: [] }],
    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['rating', 'title', 'body'], properties: { rating: { type: 'integer', minimum: 1, maximum: 5 }, title: { type: 'string' }, body: { type: 'string' } } } } } },
    responses: { 201: { description: 'Created.', content: jsonRef('#/components/schemas/Review') }, 401: commonErrors[401], 404: commonErrors[404], 409: errorResponse('You already reviewed this book.'), 422: commonErrors[422] },
  },
};
paths['/api/books/{id}/restore'] = {
  post: { tags: ['Books'], summary: 'Restore a soft-deleted book (admin)', parameters: [idParam], security: [{ bearerAuth: [] }], responses: { 200: { description: 'Restored.', content: jsonRef('#/components/schemas/Book') }, 401: commonErrors[401], 403: commonErrors[403], 404: commonErrors[404] } },
};

// Simple resources
Object.assign(paths, crudPaths('/api/authors', 'Authors', 'Author', 'Author'));
Object.assign(paths, crudPaths('/api/categories', 'Categories', 'Category', 'Category'));
Object.assign(paths, crudPaths('/api/publishers', 'Publishers', 'Publisher', 'Publisher'));

// Reviews (standalone read/update/delete)
paths['/api/reviews'] = { get: { tags: ['Reviews'], summary: 'List all reviews', parameters: listParams, responses: { 200: listResponse('#/components/schemas/Review') } } };
paths['/api/reviews/{id}'] = {
  get: { tags: ['Reviews'], summary: 'Get one review', parameters: [idParam], responses: { 200: { description: 'Found.', content: jsonRef('#/components/schemas/Review') }, 404: commonErrors[404] } },
  patch: { tags: ['Reviews'], summary: 'Update own review (or admin)', parameters: [idParam], security: [{ bearerAuth: [] }], requestBody: { content: jsonRef('#/components/schemas/Review') }, responses: { 200: { description: 'Updated.', content: jsonRef('#/components/schemas/Review') }, 401: commonErrors[401], 403: commonErrors[403], 404: commonErrors[404] } },
  delete: { tags: ['Reviews'], summary: 'Delete own review (or admin)', parameters: [idParam], security: [{ bearerAuth: [] }], responses: { 204: { description: 'Deleted.' }, 401: commonErrors[401], 403: commonErrors[403], 404: commonErrors[404] } },
};

// Users
paths['/api/users'] = { get: { tags: ['Users'], summary: 'List users (admin)', security: [{ bearerAuth: [] }], parameters: listParams, responses: { 200: listResponse('#/components/schemas/User'), 401: commonErrors[401], 403: commonErrors[403] } } };
paths['/api/users/{id}'] = {
  get: { tags: ['Users'], summary: 'Get a user (admin or self)', parameters: [idParam], security: [{ bearerAuth: [] }], responses: { 200: { description: 'Found.', content: jsonRef('#/components/schemas/User') }, 401: commonErrors[401], 403: commonErrors[403], 404: commonErrors[404] } },
  patch: { tags: ['Users'], summary: 'Update a user (admin or self)', parameters: [idParam], security: [{ bearerAuth: [] }], requestBody: { content: jsonRef('#/components/schemas/User') }, responses: { 200: { description: 'Updated.', content: jsonRef('#/components/schemas/User') }, 401: commonErrors[401], 403: commonErrors[403], 404: commonErrors[404], 409: errorResponse('Email already in use.') } },
  delete: { tags: ['Users'], summary: 'Delete a user (admin)', parameters: [idParam], security: [{ bearerAuth: [] }], responses: { 204: { description: 'Deleted.' }, 401: commonErrors[401], 403: commonErrors[403], 404: commonErrors[404] } },
};

// Cart
paths['/api/cart'] = {
  get: { tags: ['Cart'], summary: 'Get the current cart', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Cart.', content: jsonRef('#/components/schemas/Cart') }, 401: commonErrors[401] } },
  delete: { tags: ['Cart'], summary: 'Empty the cart', security: [{ bearerAuth: [] }], responses: { 204: { description: 'Emptied.' }, 401: commonErrors[401] } },
};
paths['/api/cart/items'] = {
  post: { tags: ['Cart'], summary: 'Add an item to the cart', security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['bookId'], properties: { bookId: { type: 'integer' }, quantity: { type: 'integer', default: 1 } } } } } }, responses: { 201: { description: 'Cart updated.', content: jsonRef('#/components/schemas/Cart') }, 401: commonErrors[401], 409: errorResponse('Not enough stock.'), 422: commonErrors[422] } },
};
paths['/api/cart/items/{bookId}'] = {
  patch: { tags: ['Cart'], summary: 'Set item quantity', parameters: [{ name: 'bookId', in: 'path', required: true, schema: { type: 'integer' } }], security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['quantity'], properties: { quantity: { type: 'integer' } } } } } }, responses: { 200: { description: 'Updated.', content: jsonRef('#/components/schemas/Cart') }, 401: commonErrors[401], 404: commonErrors[404] } },
  delete: { tags: ['Cart'], summary: 'Remove an item', parameters: [{ name: 'bookId', in: 'path', required: true, schema: { type: 'integer' } }], security: [{ bearerAuth: [] }], responses: { 204: { description: 'Removed.' }, 401: commonErrors[401], 404: commonErrors[404] } },
};

// Wishlist
paths['/api/wishlist'] = { get: { tags: ['Wishlist'], summary: 'Get the wishlist', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Wishlist.' }, 401: commonErrors[401] } } };
paths['/api/wishlist/items'] = { post: { tags: ['Wishlist'], summary: 'Add to wishlist', security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['bookId'], properties: { bookId: { type: 'integer' } } } } } }, responses: { 201: { description: 'Added.' }, 401: commonErrors[401], 409: errorResponse('Already in wishlist.') } } };
paths['/api/wishlist/items/{bookId}'] = { delete: { tags: ['Wishlist'], summary: 'Remove from wishlist', parameters: [{ name: 'bookId', in: 'path', required: true, schema: { type: 'integer' } }], security: [{ bearerAuth: [] }], responses: { 204: { description: 'Removed.' }, 401: commonErrors[401], 404: commonErrors[404] } } };

// Orders
paths['/api/orders'] = {
  get: { tags: ['Orders'], summary: 'List your orders (admin sees all)', security: [{ bearerAuth: [] }], parameters: listParams, responses: { 200: listResponse('#/components/schemas/Order'), 401: commonErrors[401] } },
  post: {
    tags: ['Orders'], summary: 'Create an order from the cart (idempotent)', security: [{ bearerAuth: [] }],
    parameters: [{ name: 'Idempotency-Key', in: 'header', schema: { type: 'string' }, description: 'Reuse the same key to safely retry without creating duplicate orders.' }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { shippingAddress: { type: 'string' } } } } } },
    responses: { 201: { description: 'Order created.', content: jsonRef('#/components/schemas/Order') }, 200: { description: 'Existing order returned (idempotent replay).', content: jsonRef('#/components/schemas/Order') }, 401: commonErrors[401], 409: errorResponse('Cart is empty.') },
  },
};
paths['/api/orders/{id}'] = {
  get: { tags: ['Orders'], summary: 'Get one order (owner or admin)', parameters: [idParam], security: [{ bearerAuth: [] }], responses: { 200: { description: 'Order.', content: jsonRef('#/components/schemas/Order') }, 401: commonErrors[401], 403: commonErrors[403], 404: commonErrors[404] } },
  patch: { tags: ['Orders'], summary: 'Update order or payment status (admin)', parameters: [idParam], security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', enum: ['pending', 'paid', 'packed', 'shipped', 'completed', 'delivered', 'cancelled'] }, paymentStatus: { type: 'string', enum: ['pending', 'authorized', 'paid', 'failed', 'refunded', 'cash_on_delivery'] } } } } } }, responses: { 200: { description: 'Updated.', content: jsonRef('#/components/schemas/Order') }, 401: commonErrors[401], 403: commonErrors[403], 404: commonErrors[404], 422: commonErrors[422] } },
};
paths['/api/orders/{id}/cancel'] = { post: { tags: ['Orders'], summary: 'Cancel a pending order', parameters: [idParam], security: [{ bearerAuth: [] }], responses: { 200: { description: 'Cancelled.', content: jsonRef('#/components/schemas/Order') }, 401: commonErrors[401], 403: commonErrors[403], 404: commonErrors[404], 409: errorResponse('Order can no longer be cancelled.') } } };

// Optional local chatbot. Authentication is optional on POST: a valid Bearer
// token enables cart/order tools, while anonymous catalog assistance remains public.
paths['/api/chat/status'] = {
  get: { tags: ['Chatbot'], summary: 'Check optional local-model availability', responses: { 200: { description: 'Chatbot configuration state.', content: jsonRef('#/components/schemas/ChatStatus') } } },
};
paths['/api/chat'] = {
  post: {
    tags: ['Chatbot'], summary: 'Send one grounded bookstore chat message',
    security: [{}, { bearerAuth: [] }],
    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['message'], properties: { message: { type: 'string', maxLength: 2000 }, sessionId: { type: 'string' } } } } } },
    responses: { 200: { description: 'Assistant reply or the friendly unconfigured response.', content: jsonRef('#/components/schemas/ChatResponse') }, 401: commonErrors[401], 422: commonErrors[422] },
  },
};
paths['/api/chat/session/{sessionId}'] = {
  delete: {
    tags: ['Chatbot'], summary: 'Clear a bounded in-memory chat session', security: [{}, { bearerAuth: [] }],
    parameters: [{ name: 'sessionId', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 204: { description: 'Session cleared.' }, 401: commonErrors[401], 422: commonErrors[422] },
  },
};

// Practice utilities
paths['/api/limited'] = { get: { tags: ['Practice'], summary: 'Rate-limited endpoint (429 after the limit)', responses: { 200: { description: 'Within limit.' }, 429: errorResponse('Rate limit exceeded. See Retry-After.') } } };
paths['/api/delay'] = { get: { tags: ['Practice'], summary: 'Delayed response (timeout practice)', parameters: [{ name: 'ms', in: 'query', schema: { type: 'integer', default: 1000 }, description: 'Delay in milliseconds (max 10000).' }], responses: { 200: { description: 'Responded after the delay.' } } } };
paths['/api/status/{code}'] = { get: { tags: ['Practice'], summary: 'Return a final HTTP status code from 200 to 599', parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'integer', minimum: 200, maximum: 599 } }], responses: { 200: { description: 'For 2xx/3xx codes.' }, 400: errorResponse('Code out of range.') } } };
const echoOperation = (method) => ({ tags: ['Practice'], summary: `Echo a ${method.toUpperCase()} request back`, requestBody: ['post', 'put', 'patch'].includes(method) ? { content: { 'application/json': { schema: { type: 'object' } } } } : undefined, responses: { 200: { description: 'Echo.' } } });
paths['/api/echo'] = { get: echoOperation('get'), post: echoOperation('post'), put: echoOperation('put'), patch: echoOperation('patch'), delete: echoOperation('delete') };

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'Tech Book Store Practice API',
    version: '1.0.0',
    description: 'A zero-dependency practice API for learning API test automation with Playwright. '
      + 'Seeded accounts: admin@bookstore.test / admin123 (admin) and user@bookstore.test / password123 (user). '
      + 'Call POST /api/reset any time to restore the original data.',
    contact: { name: 'Tech Book Store Practice API' },
    license: { name: 'MIT' },
  },
  servers: [server],
  tags: [
    { name: 'System', description: 'Health and data reset.' },
    { name: 'Auth', description: 'Registration, login, tokens, API key and Basic auth practice.' },
    { name: 'Books', description: 'The richest resource: CRUD, ETag concurrency, soft delete.' },
    { name: 'Authors', description: 'Author records.' },
    { name: 'Categories', description: 'Category records.' },
    { name: 'Publishers', description: 'Publisher records.' },
    { name: 'Reviews', description: 'Book reviews.' },
    { name: 'Users', description: 'User accounts with ownership rules.' },
    { name: 'Cart', description: 'Per-user shopping cart.' },
    { name: 'Wishlist', description: 'Per-user wishlist.' },
    { name: 'Orders', description: 'Checkout with idempotency keys.' },
    { name: 'Chatbot', description: 'Optional local Ollama assistant; no paid API key required.' },
    { name: 'Practice', description: 'Isolated endpoints for rate limits, delays, status codes, echo.' },
  ],
  paths,
  components: {
    schemas,
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Use the accessToken from login.' },
      apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      basicAuth: { type: 'http', scheme: 'basic' },
    },
  },
};

const outPath = path.join(__dirname, '..', 'docs', 'openapi.json');
fs.writeFileSync(outPath, JSON.stringify(spec, null, 2));
// eslint-disable-next-line no-console
console.log(`Wrote ${outPath} (${Object.keys(paths).length} paths).`);
