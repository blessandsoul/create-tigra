import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';

import { getFieldErrors } from '@/lib/utils/error';

/**
 * Put the server's verdict on wrong input (422 VALIDATION_FAILED, one message
 * per field) onto the form's own fields, so it shows where the client rules
 * show theirs. The client rules mirror the server's, but the server is the one
 * that decides: whatever slips through (a rule changed on one side only) still
 * lands under the right field instead of only in a toast.
 *
 * Only the form's own `fields` are set; anything else (a field the form does
 * not have) stays in the toast the auth hooks show. Returns whether any field
 * got a message. Call it from an effect on the request's error.
 */
export function applyFieldErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[]
): boolean {
  const byField = getFieldErrors(error);
  let applied = false;
  for (const field of fields) {
    const message = byField[field];
    if (message) {
      setError(field, { type: 'server', message });
      applied = true;
    }
  }
  return applied;
}
