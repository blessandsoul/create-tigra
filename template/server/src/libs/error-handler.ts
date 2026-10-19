/**
 * The global error handler: every thrown error becomes the standard envelope
 * ({ success: false, error: { code, message, ... } }). Register it before the
 * routes (src/app.ts). Kept in its own module so tests can mount it on a small
 * Fastify instance (src/libs/__tests__/error-handler.test.ts).
 *
 * Order matters:
 * 1. AppError: our typed errors keep their status and code (plus
 *    retryAfterSeconds and fields when they carry them).
 * 2. Wrong input (route schema or ZodError): 422 VALIDATION_FAILED with the
 *    field list, never the values (libs/validation-errors.ts).
 * 3. Other 4xx from Fastify or a plugin (malformed JSON, body too large,
 *    rate limit, multipart limits): their status, a mapped code and a fixed or
 *    Fastify message.
 * 4. Anything else: logged with its stack, sent to Sentry (a no-op unless
 *    configured), and answered with a generic 500 that reveals nothing.
 */
import type { FastifyError, FastifyInstance } from 'fastify';
import { logger } from '@libs/logger.js';
import { Sentry } from '@libs/observability/sentry.js';
import { fieldsFromSchemaValidation, fieldsFromZodIssues, validationError } from '@libs/validation-errors.js';
import { isAppError } from '@shared/errors/AppError.js';
import { errorResponse } from '@shared/responses/successResponse.js';

/** @fastify/multipart's limit errors other than a too-large file (all 413). */
const MULTIPART_LIMIT_CODES = new Set(['FST_PARTS_LIMIT', 'FST_FIELDS_LIMIT', 'FST_FILES_LIMIT']);

/** A ZodError thrown by `schema.parse()` in a handler (duck-typed: no instanceof across zod copies). */
function zodIssues(error: unknown): ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }> | null {
  if (!(error instanceof Error) || error.name !== 'ZodError') return null;
  const issues = (error as { issues?: unknown }).issues;
  return Array.isArray(issues) ? issues : null;
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    // A multipart limit hit while a FILE part is already being read: the plugin
    // destroys that file stream, so the handler's toBuffer() rejects with a bare
    // "Premature close" (no status) instead of FST_FIELDS_LIMIT and the like.
    // Typical case: many fields, then the file. On a multipart request that is
    // a limit hit; a client that hung up mid-upload lands here too, but nobody
    // is left to read the answer. Without this it would be a logged 500.
    if (error.code === 'ERR_STREAM_PREMATURE_CLOSE' && request.isMultipart?.()) {
      return reply.status(413).send(errorResponse('MULTIPART_LIMIT', 'Too many form fields or files in this upload'));
    }

    // AppError — our typed errors (use duck-type check to avoid instanceof issues)
    if (isAppError(error)) {
      return reply
        .status(error.statusCode)
        .send(errorResponse(error.code, error.message, error.retryAfterSeconds, error.fields));
    }

    // Wrong input caught by a route schema: `validation` holds the items and
    // `validationContext` the request part (body, querystring, params, headers).
    if (error.validation) {
      const fail = validationError(fieldsFromSchemaValidation(error.validation, error.validationContext));
      return reply.status(fail.statusCode).send(errorResponse(fail.code, fail.message, undefined, fail.fields));
    }

    // Wrong input caught by `schema.parse()` inside a handler.
    const issues = zodIssues(error);
    if (issues) {
      const fail = validationError(fieldsFromZodIssues(issues));
      return reply.status(fail.statusCode).send(errorResponse(fail.code, fail.message, undefined, fail.fields));
    }

    // Fastify plugin errors (malformed JSON, file size, rate limiting, etc.)
    // These have statusCode properties but aren't AppError instances
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      // Too many parts, fields or files in one multipart upload (MULTIPART_LIMITS
      // in libs/storage/file-validator.ts). 413 like a too-large file, but with
      // its own code so the client does not tell the user their file is too big.
      if (MULTIPART_LIMIT_CODES.has(error.code)) {
        return reply
          .status(413)
          .send(errorResponse('MULTIPART_LIMIT', 'Too many form fields or files in this upload'));
      }

      // Map common Fastify error codes to user-friendly messages
      const errorCodeMap: Record<number, { code: string; message: string }> = {
        413: { code: 'FILE_TOO_LARGE', message: 'File size exceeds the maximum allowed limit' },
        429: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests. Please try again later' },
      };

      const errorInfo = errorCodeMap[error.statusCode] || {
        code: 'BAD_REQUEST',
        message: error.message || 'Bad request',
      };

      return reply.status(error.statusCode).send(errorResponse(errorInfo.code, errorInfo.message));
    }

    // Unexpected error — capture in Sentry (safe no-op when SDK uninitialized),
    // then log and return a generic 500. reqId ties the event to the log line.
    const requestId = request.id || 'unknown';
    Sentry.captureException(error, { extra: { reqId: requestId } });
    logger.error(
      {
        err: error,
        requestId,
        url: request.url,
        method: request.method,
        stack: error.stack,
      },
      `Unhandled error [${requestId}]: ${error.message}`,
    );

    return reply.status(500).send(errorResponse('INTERNAL_ERROR', 'Internal server error'));
  });
}
