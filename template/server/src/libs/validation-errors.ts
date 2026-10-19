/**
 * One answer for wrong input, whichever layer catches it: a route schema
 * (fastify-type-provider-zod), a `schema.parse()` inside a handler, or
 * `parseInput()` below. Every case becomes
 *
 *   422 { success: false, error: { code: 'VALIDATION_FAILED',
 *         message: 'Please check these fields: email, password',
 *         fields: [{ field: 'email', message: 'Invalid email address' }, ...] } }
 *
 * Never the submitted values: messages come from Zod (or Ajv), which describe
 * the rule ("Too small: expected string to have >=8 characters"), and Zod
 * drops an issue's `input` unless `reportInput` is set, which nothing here
 * does. Keep it that way: a value in a validation answer can leak a password
 * into logs, screenshots or a support ticket.
 *
 * Malformed JSON is not "wrong input" but an unreadable request; it stays a
 * 400 BAD_REQUEST in libs/error-handler.ts.
 */
import type { z } from 'zod';
import type { FieldError } from '@shared/errors/AppError.js';
import { ValidationError } from '@shared/errors/errors.js';

export const VALIDATION_FAILED = 'VALIDATION_FAILED';

/** Enough to fix a form; caps the answer when a whole object is wrong. */
export const MAX_FIELD_ERRORS = 20;

interface IssueLike {
  path: ReadonlyArray<PropertyKey>;
  message: string;
}

/** Fastify's names for the request parts, shown when the whole part is wrong. */
const PART_NAMES: Record<string, string> = { body: 'body', querystring: 'query', params: 'params', headers: 'headers' };

function partName(context: string | undefined): string {
  return (context && PART_NAMES[context]) ?? 'input';
}

/** Zod issues (from `.parse()` / `.safeParse()`) as field errors. */
export function fieldsFromZodIssues(issues: ReadonlyArray<IssueLike>, context?: string): FieldError[] {
  return issues.slice(0, MAX_FIELD_ERRORS).map((issue) => ({
    field: issue.path.length > 0 ? issue.path.map(String).join('.') : partName(context),
    message: issue.message,
  }));
}

/**
 * Fastify schema-validation items as field errors. fastify-type-provider-zod
 * and Fastify's own Ajv both report `instancePath` ("/address/city") and
 * `message`; `context` is the request part that failed (Fastify validates
 * params, body, querystring, headers in that order and stops at the first).
 */
export function fieldsFromSchemaValidation(
  validation: ReadonlyArray<{ instancePath?: string; message?: string }>,
  context?: string,
): FieldError[] {
  return validation.slice(0, MAX_FIELD_ERRORS).map((item) => {
    const path = (item.instancePath ?? '').split('/').filter(Boolean).join('.');
    return { field: path || partName(context), message: item.message ?? 'Invalid value' };
  });
}

/** The human summary: "Please check these fields: email, password". */
export function validationMessage(fields: ReadonlyArray<FieldError>): string {
  const names = [...new Set(fields.map((f) => f.field))];
  return names.length > 0 ? `Please check these fields: ${names.join(', ')}` : 'Validation failed';
}

/** The 422 error for these fields (thrown, or built by the global handler). */
export function validationError(fields: FieldError[]): ValidationError {
  return new ValidationError(validationMessage(fields), VALIDATION_FAILED, fields);
}

/**
 * Validate input inside a handler (when a route schema cannot express the
 * rule, or for data that is not a request part). Returns the parsed value or
 * throws the standard 422.
 */
export function parseInput<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw validationError(fieldsFromZodIssues(result.error.issues));
  }
  return result.data;
}
