export function successResponse<T>(message: string, data: T): {
  success: true;
  message: string;
  data: T;
} {
  return { success: true as const, message, data };
}

import type { FieldError } from '@shared/errors/AppError.js';

/**
 * Error envelope. Optional members appear only when they apply:
 * - `retryAfterSeconds` when the caller can retry after a known wait (429s and
 *   an automatic IP block); the client uses it to say "try again in N minutes";
 * - `fields` on 422 VALIDATION_FAILED: each wrong input field and why, never
 *   the submitted value.
 */
export function errorResponse(
  code: string,
  message: string,
  retryAfterSeconds?: number,
  fields?: FieldError[],
): {
  success: false;
  error: { code: string; message: string; retryAfterSeconds?: number; fields?: FieldError[] };
} {
  return {
    success: false as const,
    error: {
      code,
      message,
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
      ...(fields && fields.length > 0 ? { fields } : {}),
    },
  };
}
