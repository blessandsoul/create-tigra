export class AppError extends Error {
  public readonly isAppError = true;
  public readonly code: string;
  public readonly statusCode: number;

  constructor(code: string, message: string, statusCode: number) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
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
