'use strict';

/*
 * List-endpoint query features. Every collection endpoint (GET /api/books,
 * etc.) runs its records through this pipeline based on the URL query string:
 *
 *   ?page=2&limit=10          -> pagination
 *   ?sort=price&order=desc    -> sorting
 *   ?search=playwright        -> free-text search over configured fields
 *   ?fields=id,title,price    -> sparse fieldsets (return only chosen fields)
 *   ?<field>=<value>          -> exact-match filtering (e.g. ?inStock=true)
 *   ?minPrice=20&maxPrice=40  -> range filtering for numeric fields
 *
 * The function returns { data, meta } where meta describes the pagination so
 * clients (and tests) can assert on totals and page counts.
 */

const config = require('../config');

const RESERVED = new Set([
  'page', 'limit', 'sort', 'order', 'search', 'fields',
  'delay', // handled by middleware, not a filter
  'includeDeleted', // handled per-route
]);

function coerce(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value !== '' && !Number.isNaN(Number(value))) return Number(value);
  return value;
}

function applyQuery(records, searchParams, options) {
  const opts = options || {};
  const searchableFields = opts.searchableFields || [];
  let result = records.slice();

  // ----- Filtering (exact match on any field, plus min/max ranges) -----
  for (const [key, rawValue] of searchParams.entries()) {
    if (RESERVED.has(key)) continue;

    // Range filters: minX / maxX where X is a numeric field (first letter lowercased).
    if (key.startsWith('min') && key.length > 3) {
      const field = key[3].toLowerCase() + key.slice(4);
      const threshold = Number(rawValue);
      if (!Number.isNaN(threshold)) {
        result = result.filter((r) => typeof r[field] === 'number' && r[field] >= threshold);
      }
      continue;
    }
    if (key.startsWith('max') && key.length > 3) {
      const field = key[3].toLowerCase() + key.slice(4);
      const threshold = Number(rawValue);
      if (!Number.isNaN(threshold)) {
        result = result.filter((r) => typeof r[field] === 'number' && r[field] <= threshold);
      }
      continue;
    }

    // Exact-match filter on a real field.
    const wanted = coerce(rawValue);
    result = result.filter((r) => {
      if (!(key in r)) return true; // ignore unknown filter keys rather than 400
      return r[key] === wanted;
    });
  }

  // ----- Search (case-insensitive substring over configured fields) -----
  const search = searchParams.get('search');
  if (search && searchableFields.length > 0) {
    const needle = search.toLowerCase();
    result = result.filter((r) =>
      searchableFields.some((f) => String(r[f] || '').toLowerCase().includes(needle))
    );
  }

  // ----- Sorting -----
  const sort = searchParams.get('sort');
  const order = (searchParams.get('order') || 'asc').toLowerCase() === 'desc' ? -1 : 1;
  if (sort) {
    result.sort((a, b) => {
      const av = a[sort];
      const bv = b[sort];
      if (av === undefined && bv === undefined) return 0;
      if (av === undefined) return 1;
      if (bv === undefined) return -1;
      if (av < bv) return -1 * order;
      if (av > bv) return 1 * order;
      return 0;
    });
  }

  const total = result.length;

  // ----- Pagination -----
  let page = Number.parseInt(searchParams.get('page') || '1', 10);
  let limit = Number.parseInt(searchParams.get('limit') || String(config.defaultPageSize), 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(limit) || limit < 1) limit = config.defaultPageSize;
  if (limit > config.maxPageSize) limit = config.maxPageSize;

  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
  const start = (page - 1) * limit;
  const pageItems = result.slice(start, start + limit);

  // ----- Sparse fieldsets -----
  const fields = searchParams.get('fields');
  let shaped = pageItems;
  if (fields) {
    const wanted = fields.split(',').map((f) => f.trim()).filter(Boolean);
    shaped = pageItems.map((r) => {
      const picked = {};
      for (const f of wanted) if (f in r) picked[f] = r[f];
      return picked;
    });
  }

  return {
    data: shaped,
    meta: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
}

module.exports = { applyQuery };
