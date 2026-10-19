/**
 * One wrong input field in a 422 VALIDATION_FAILED answer: where it is and
 * why it was refused. Never the submitted value (see libs/validation-errors.ts).
 */
export interface FieldError {
  /** Path inside the request part, dot-joined ("email", "address.city"), or the part itself ("body"). */
  field: string;
  message: string;
}

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
  /** The wrong fields, for validation failures only (sent as `error.fields`). */
  public readonly fields?: FieldError[];

  constructor(
    code: string,
    message: string,
    statusCode: number,
    retryAfterSeconds?: number,
    fields?: FieldError[],
  ) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.retryAfterSeconds = retryAfterSeconds;
    this.fields = fields;
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
