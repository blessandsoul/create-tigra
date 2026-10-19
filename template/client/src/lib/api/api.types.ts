export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
}

export interface PaginatedApiResponse<T> {
  success: boolean;
  message: string;
  data: {
    items: T[];
    pagination: {
      page: number;
      limit: number;
      totalItems: number;
      totalPages: number;
      hasNextPage: boolean;
      hasPreviousPage: boolean;
    };
  };
}

/** One wrong input field in a 422 VALIDATION_FAILED answer (never the submitted value). */
export interface ApiFieldError {
  /** Dot path inside the request part ("email", "address.city"), or the part itself ("body"). */
  field: string;
  message: string;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    /**
     * Whole seconds until a retry can work. Sent on rate limits (429) and an
     * automatic IP block (403 IP_BLOCKED); see getLimitInfo in lib/utils/error.ts.
     */
    retryAfterSeconds?: number;
    /** Sent on 422 VALIDATION_FAILED: every wrong field and why; see getFieldErrors. */
    fields?: ApiFieldError[];
  };
}

export interface PaginationParams {
  page?: number;
  limit?: number;
}
