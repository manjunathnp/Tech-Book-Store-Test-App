'use strict';

/*
 * A small family of error classes. Route handlers throw these, and one central
 * error handler turns them into a consistent JSON error envelope. This keeps
 * every handler clean: they describe *what went wrong*, not *how to format it*.
 *
 * Error envelope shape (used everywhere):
 *   {
 *     "error": {
 *       "code": "NOT_FOUND",
 *       "message": "Book 999 was not found.",
 *       "details": [ ... optional field-level items ... ]
 *     }
 *   }
 */

class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details || [];
    // Optional extra headers a specific error wants to set (for example
    // Retry-After on 429, or WWW-Authenticate on 401).
    this.headers = {};
  }

  toEnvelope() {
    const error = { code: this.code, message: this.message };
    if (this.details && this.details.length > 0) {
      error.details = this.details;
    }
    return { error };
  }
}

class BadRequestError extends ApiError {
  constructor(message, details) {
    super(400, 'BAD_REQUEST', message || 'The request was malformed.', details);
  }
}

class UnauthorizedError extends ApiError {
  constructor(message) {
    super(401, 'UNAUTHORIZED', message || 'Authentication is required or has failed.');
    this.headers['WWW-Authenticate'] = 'Bearer';
  }
}

class ForbiddenError extends ApiError {
  constructor(message) {
    super(403, 'FORBIDDEN', message || 'You do not have permission to perform this action.');
  }
}

class NotFoundError extends ApiError {
  constructor(message) {
    super(404, 'NOT_FOUND', message || 'The requested resource was not found.');
  }
}

class ConflictError extends ApiError {
  constructor(message, details) {
    super(409, 'CONFLICT', message || 'The request conflicts with the current state.', details);
  }
}

class GoneError extends ApiError {
  constructor(message) {
    super(410, 'GONE', message || 'The resource has been deleted and is no longer available.');
  }
}

class PreconditionFailedError extends ApiError {
  constructor(message) {
    super(412, 'PRECONDITION_FAILED', message || 'A precondition (for example If-Match) failed.');
  }
}

class UnsupportedMediaTypeError extends ApiError {
  constructor(message) {
    super(415, 'UNSUPPORTED_MEDIA_TYPE', message || 'The Content-Type must be application/json.');
  }
}

class PayloadTooLargeError extends ApiError {
  constructor(message) {
    super(413, 'PAYLOAD_TOO_LARGE', message || 'The request body exceeds the maximum allowed size.');
  }
}

class ValidationError extends ApiError {
  constructor(details, message) {
    super(422, 'VALIDATION_ERROR', message || 'One or more fields are invalid.', details);
  }
}

class RateLimitError extends ApiError {
  constructor(retryAfterSeconds, message) {
    super(429, 'RATE_LIMITED', message || 'Too many requests. Please slow down.');
    this.headers['Retry-After'] = String(retryAfterSeconds);
  }
}

module.exports = {
  ApiError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  GoneError,
  PreconditionFailedError,
  UnsupportedMediaTypeError,
  PayloadTooLargeError,
  ValidationError,
  RateLimitError,
};
