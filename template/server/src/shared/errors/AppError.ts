export class AppError extends Error {
  public readonly isAppError = true;
  public readonly code: string;
  public readonly statusCode: number;
  /**
   * Whole seconds until the caller may try again (rate limits, login lock, IP
   * auto-block). Sent in the JSON body because the client runs on another
   * origin and CORS does not expose the Retry-After header to it.
   */
  public readonly retryAfterSeconds?: number;

  constructor(code: string, message: string, statusCode: number, retryAfterSeconds?: number) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.retryAfterSeconds = retryAfterSeconds;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export function isAppError(error: unknown): error is AppError {
  return (
    error instanceof Error &&
    'isAppError' in error &&
    (error as AppError).isAppError === true
  );
}
