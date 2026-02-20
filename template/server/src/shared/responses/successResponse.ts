export function successResponse<T>(message: string, data: T): {
  success: true;
  message: string;
  data: T;
} {
  return { success: true as const, message, data };
}

export function errorResponse(code: string, message: string): {
  success: false;
  error: { code: string; message: string };
} {
  return {
    success: false as const,
    error: { code, message },
  };
}
