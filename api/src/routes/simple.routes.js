'use strict';

/*
 * Authors, Categories, and Publishers.
 * These are straightforward resources, so they use the shared CRUD factory.
 */

const crypto = require('crypto');
const { register } = require('./crudFactory');

function uuid() {
  return crypto.randomUUID();
}

function registerSimpleRoutes(router) {
  // ----- Authors -----
  register(router, {
    basePath: '/api/authors',
    collection: 'authors',
    singular: 'Author',
    searchableFields: ['name', 'bio', 'country'],
    createSchema: {
      name: { type: 'string', required: true, min: 1, max: 120 },
      bio: { type: 'string', max: 2000 },
      country: { type: 'string', max: 2 },
    },
    updateSchema: {
      name: { type: 'string', min: 1, max: 120 },
      bio: { type: 'string', max: 2000 },
      country: { type: 'string', max: 2 },
    },
    buildCreate: (b) => ({
      uuid: uuid(),
      name: b.name,
      bio: b.bio || '',
      country: b.country || '',
    }),
    applyUpdate: (record, b) => {
      if (b.name !== undefined) record.name = b.name;
      if (b.bio !== undefined) record.bio = b.bio;
      if (b.country !== undefined) record.country = b.country;
    },
  });

  // ----- Categories -----
  register(router, {
    basePath: '/api/categories',
    collection: 'categories',
    singular: 'Category',
    searchableFields: ['name', 'description', 'slug'],
    createSchema: {
      name: { type: 'string', required: true, min: 1, max: 80 },
      description: { type: 'string', max: 500 },
    },
    updateSchema: {
      name: { type: 'string', min: 1, max: 80 },
      description: { type: 'string', max: 500 },
    },
    buildCreate: (b) => ({
      uuid: uuid(),
      name: b.name,
      slug: String(b.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      description: b.description || '',
    }),
    applyUpdate: (record, b) => {
      if (b.name !== undefined) {
        record.name = b.name;
        record.slug = String(b.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      }
      if (b.description !== undefined) record.description = b.description;
    },
  });

  // ----- Publishers -----
  register(router, {
    basePath: '/api/publishers',
    collection: 'publishers',
    singular: 'Publisher',
    searchableFields: ['name', 'city'],
    createSchema: {
      name: { type: 'string', required: true, min: 1, max: 120 },
      city: { type: 'string', max: 80 },
      foundedYear: { type: 'integer', min: 1400, max: 2100 },
    },
    updateSchema: {
      name: { type: 'string', min: 1, max: 120 },
      city: { type: 'string', max: 80 },
      foundedYear: { type: 'integer', min: 1400, max: 2100 },
    },
    buildCreate: (b) => ({
      uuid: uuid(),
      name: b.name,
      city: b.city || '',
      foundedYear: b.foundedYear || null,
    }),
    applyUpdate: (record, b) => {
      if (b.name !== undefined) record.name = b.name;
      if (b.city !== undefined) record.city = b.city;
      if (b.foundedYear !== undefined) record.foundedYear = b.foundedYear;
    },
  });
}

module.exports = { registerSimpleRoutes };
