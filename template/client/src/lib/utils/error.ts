import axios from 'axios';

import type { ApiError } from '@/lib/api/api.types';

export const getErrorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const apiError = error.response?.data as ApiError;
    if (apiError?.error?.message) {
      return apiError.error.message;
    }
    if (error.code === 'ERR_NETWORK') {
      return 'Network error. Check your connection.';
    }
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'An unexpected error occurred';
};

export const getErrorCode = (error: unknown): string | undefined => {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as ApiError | undefined;
    return data?.error?.code;
  }
  return undefined;
};

export const isErrorCode = (error: unknown, code: string): boolean => {
  return getErrorCode(error) === code;
};

// Account-state codes from the server (src/libs/account-status.ts). They are
// separate on purpose: a deactivated (banned) account must never be steered to
// email verification, because verifying cannot lift a ban.
// RATE_LIMIT_EXCEEDED to IP_BLOCKED are the "wait and retry" answers (server
// docs/rate-limits.md). VALIDATION_FAILED is wrong input (see getFieldErrors).
// REFRESH_TOKEN_ROTATED: this tab lost a refresh race with another tab, which
// already set fresh cookies; not a dead session (lib/api/axios.config.ts).
// Keep this an object literal: the email-verification patcher appends to it.
export const ERROR_CODES = {
  ACCOUNT_DEACTIVATED: 'ACCOUNT_DEACTIVATED',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  REFRESH_TOKEN_ROTATED: 'REFRESH_TOKEN_ROTATED',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  LOGIN_LOCKED: 'LOGIN_LOCKED',
  EMAIL_RATE_LIMITED: 'EMAIL_RATE_LIMITED',
  IP_BLOCKED: 'IP_BLOCKED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
} as const;

/**
 * The server's verdict per field on a 422 VALIDATION_FAILED answer, as
 * { email: 'Invalid email address', ... } (first message per field). Empty for
 * any other error. Forms can pass these to react-hook-form's setError; the
 * error's message already names the fields for a toast.
 */
export const getFieldErrors = (error: unknown): Record<string, string> => {
  if (!axios.isAxiosError(error)) return {};
  const data = error.response?.data as ApiError | undefined;
  if (data?.error?.code !== ERROR_CODES.VALIDATION_FAILED) return {};
  // A Map, then fromEntries: field names become own keys only, whatever they are.
  const firsts = new Map<string, string>();
  for (const { field, message } of data.error.fields ?? []) {
    if (!firsts.has(field)) firsts.set(field, message);
  }
  return Object.fromEntries(firsts);
};

/** "45 seconds", "1 minute", "15 minutes": minutes round up, so nobody retries too early. */
export const formatWait = (seconds: number): string => {
  const s = Math.max(1, Math.ceil(seconds));
  if (s < 60) return `${s} ${s === 1 ? 'second' : 'seconds'}`;
  const m = Math.ceil(s / 60);
  return `${m} ${m === 1 ? 'minute' : 'minutes'}`;
};

export interface LimitInfo {
  code: string;
  retryAfterSeconds?: number;
  /** Plain message for the person, with the wait time when the server sent one. */
  message: string;
}

/**
 * Recognise a "slow down" answer: a route rate limit, a login lock, the
 * per-address email cap or a blocked network. Returns null for any other
 * error. Wording lives here (not in the server's message) so every screen
 * says the same thing.
 */
export const getLimitInfo = (error: unknown): LimitInfo | null => {
  if (!axios.isAxiosError(error)) return null;
  const status = error.response?.status;
  const data = error.response?.data as ApiError | undefined;
  const code = data?.error?.code ?? (status === 429 ? ERROR_CODES.RATE_LIMIT_EXCEEDED : undefined);
  const seconds = data?.error?.retryAfterSeconds;
  const wait = seconds ? ` Try again in ${formatWait(seconds)}.` : ' Please wait a moment and try again.';

  switch (code) {
    case ERROR_CODES.RATE_LIMIT_EXCEEDED:
      return { code, retryAfterSeconds: seconds, message: `Too many requests.${wait}` };
    case ERROR_CODES.LOGIN_LOCKED:
      return { code, retryAfterSeconds: seconds, message: `Too many failed sign-in attempts.${wait}` };
    case ERROR_CODES.EMAIL_RATE_LIMITED:
      return { code, retryAfterSeconds: seconds, message: `Too many emails were sent to this address.${wait}` };
    case ERROR_CODES.IP_BLOCKED:
      return {
        code,
        retryAfterSeconds: seconds,
        message: seconds
          ? `Too many requests from your network. Try again in ${formatWait(seconds)}.`
          : 'Access from your network is blocked.',
      };
    default:
      return null;
  }
};

/** True for the answers getLimitInfo recognises. Such requests must not be retried. */
export const isLimitError = (error: unknown): boolean => getLimitInfo(error) !== null;
