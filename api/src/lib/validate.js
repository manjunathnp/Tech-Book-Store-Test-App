'use strict';

/*
 * A tiny schema validator. It walks a schema description and collects a list
 * of field-level problems. If any exist, the caller throws a ValidationError
 * (HTTP 422) carrying those details, so clients get precise feedback like:
 *
 *   { "field": "price", "message": "price must be a number", "code": "type" }
 *
 * Supported rules per field:
 *   type: 'string' | 'number' | 'integer' | 'boolean' | 'array'
 *   required: true
 *   min / max: numeric bounds (value for numbers, length for strings/arrays)
 *   enum: [allowed values]
 *   email: true (basic email shape)
 */

const { ValidationError } = require('./errors');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function checkType(value, type) {
  switch (type) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'array': return Array.isArray(value);
    default: return true;
  }
}

function validate(payload, schema, options) {
  const opts = options || {};
  const partial = opts.partial === true; // PATCH: only validate provided fields
  const details = [];
  const data = payload && typeof payload === 'object' ? payload : {};

  for (const [field, rules] of Object.entries(schema)) {
    const present = Object.prototype.hasOwnProperty.call(data, field);
    const value = data[field];

    if (!present) {
      if (rules.required && !partial) {
        details.push({ field, message: `${field} is required.`, code: 'required' });
      }
      continue;
    }

    if (value === null && rules.nullable) continue;

    if (rules.type && !checkType(value, rules.type)) {
      details.push({ field, message: `${field} must be of type ${rules.type}.`, code: 'type' });
      continue; // no point checking further rules on a wrong-typed value
    }

    if (rules.enum && !rules.enum.includes(value)) {
      details.push({
        field,
        message: `${field} must be one of: ${rules.enum.join(', ')}.`,
        code: 'enum',
      });
    }

    if (rules.email && !EMAIL_RE.test(String(value))) {
      details.push({ field, message: `${field} must be a valid email address.`, code: 'email' });
    }

    if (typeof rules.min === 'number') {
      const measure = typeof value === 'string' || Array.isArray(value) ? value.length : value;
      if (measure < rules.min) {
        details.push({
          field,
          message: `${field} must be at least ${rules.min}.`,
          code: 'min',
        });
      }
    }

    if (typeof rules.max === 'number') {
      const measure = typeof value === 'string' || Array.isArray(value) ? value.length : value;
      if (measure > rules.max) {
        details.push({
          field,
          message: `${field} must be at most ${rules.max}.`,
          code: 'max',
        });
      }
    }
  }

  if (details.length > 0) {
    throw new ValidationError(details);
  }

  return data;
}

module.exports = { validate };
