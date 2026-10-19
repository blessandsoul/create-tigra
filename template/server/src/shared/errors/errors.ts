import { AppError, type FieldError } from './AppError.js';

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', code = 'BAD_REQUEST') {
    super(code, message, 400);
  }
}

/**
 * 422. With `fields` it is the one shape for wrong input (VALIDATION_FAILED,
 * built by libs/validation-errors.ts); without, a specific check such as an
 * upload's FILE_* or IMAGE_* code.
 */
export class ValidationError extends AppError {
  constructor(message = 'Validation failed', code = 'VALIDATION_FAILED', fields?: FieldError[]) {
    super(code, message, 422, undefined, fields);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized', code = 'UNAUTHORIZED') {
    super(code, message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', code = 'FORBIDDEN', retryAfterSeconds?: number) {
    super(code, message, 403, retryAfterSeconds);
  }
}

/**
 * 429 with the wait time. Codes in use: RATE_LIMIT_EXCEEDED (a route limit),
 * LOGIN_LOCKED (too many failed sign-ins for this email + IP) and
 * EMAIL_RATE_LIMITED (too many emails to one address). See docs/rate-limits.md.
 */
export class TooManyRequestsError extends AppError {
  constructor(message: string, code: string, retryAfterSeconds: number) {
    super(code, message, 429, Math.max(1, Math.ceil(retryAfterSeconds)));
  }
}

/**
 * Human wait time for user-facing messages: "45 seconds", "1 minute", "15 minutes".
 * Minutes round up, so the user is never told to retry too early.
 */
export function describeWait(seconds: number): string {
  const s = Math.max(1, Math.ceil(seconds));
  if (s < 60) return `${s} ${s === 1 ? 'second' : 'seconds'}`;
  const m = Math.ceil(s / 60);
  return `${m} ${m === 1 ? 'minute' : 'minutes'}`;
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', code = 'NOT_FOUND') {
    super(code, message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource already exists', code = 'CONFLICT') {
    super(code, message, 409);
  }
}

/**
 * 503: a feature that depends on something temporarily down (e.g. Redis for
 * password-reset and verification tokens). The request was fine; retry later.
 */
export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable', code = 'SERVICE_UNAVAILABLE') {
    super(code, message, 503);
  }
}

export class InternalError extends AppError {
  constructor(message = 'Internal server error', code = 'INTERNAL_ERROR') {
    super(code, message, 500);
  }
}
