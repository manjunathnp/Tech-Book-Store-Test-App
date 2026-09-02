'use strict';

/*
 * The in-memory data store.
 *
 * On boot (and on every POST /api/reset) we deep-clone a fresh copy of the
 * seed data. Cloning matters: it guarantees that mutations made during tests
 * never leak into the pristine seed, so a reset always restores the exact
 * original state.
 */

const { buildSeed } = require('./seed');
const tokens = require('./auth/tokens');

let state = null;

function deepClone(value) {
  // structuredClone is built into modern Node and handles nested objects,
  // arrays, dates, etc. without any external library.
  return structuredClone(value);
}

function init() {
  state = deepClone(buildSeed());
}

function reset() {
  init();
  tokens.reset(); // also clear issued/revoked tokens so auth starts clean
}

function getState() {
  if (!state) init();
  return state;
}

// Return the next id for a collection and advance its counter.
function nextId(collectionName) {
  const s = getState();
  s.counters[collectionName] += 1;
  return s.counters[collectionName];
}

module.exports = { init, reset, getState, nextId };
