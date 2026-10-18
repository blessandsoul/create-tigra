export function successResponse<T>(message: string, data: T): {
  success: true;
  message: string;
  data: T;
} {
  return { success: true as const, message, data };
}

/**
 * Error envelope. `retryAfterSeconds` is included only when the caller can
 * retry after a known wait (429s and an automatic IP block); the client uses
 * it to say "try again in N minutes".
 */
export function errorResponse(
  code: string,
  message: string,
  retryAfterSeconds?: number,
): {
  success: false;
  error: { code: string; message: string; retryAfterSeconds?: number };
} {
  return {
    success: false as const,
    error: retryAfterSeconds === undefined ? { code, message } : { code, message, retryAfterSeconds },
  };
}
