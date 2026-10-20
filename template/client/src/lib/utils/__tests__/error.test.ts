import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, it } from 'vitest';

import {
  formatWait,
  getErrorCode,
  getErrorMessage,
  getFieldErrors,
  getLimitInfo,
  isLimitError,
} from '../error';

/** An axios error carrying the server's answer, as the API client sees it. */
function apiError(status: number, error?: Record<string, unknown>): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, undefined, {
    status,
    statusText: '',
    headers: {},
    config,
    data: error ? { success: false, error } : undefined,
  });
}

describe('getLimitInfo ("slow down" answers)', () => {
  it('a bare 429 is a rate limit with a generic wait', () => {
    expect(getLimitInfo(apiError(429))).toEqual({
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfterSeconds: undefined,
      message: 'Too many requests. Please wait a moment and try again.',
    });
  });

  it('uses the server wait, rounded up to whole minutes', () => {
    const info = getLimitInfo(apiError(429, { code: 'RATE_LIMIT_EXCEEDED', message: 'x', retryAfterSeconds: 90 }));
    expect(info?.message).toBe('Too many requests. Try again in 2 minutes.');
  });

  it('a login lock and the email cap have their own wording', () => {
    expect(getLimitInfo(apiError(429, { code: 'LOGIN_LOCKED', message: 'x', retryAfterSeconds: 900 }))?.message).toBe(
      'Too many failed sign-in attempts. Try again in 15 minutes.',
    );
    expect(getLimitInfo(apiError(429, { code: 'EMAIL_RATE_LIMITED', message: 'x', retryAfterSeconds: 30 }))?.message).toBe(
      'Too many emails were sent to this address. Try again in 30 seconds.',
    );
  });

  it('an IP block says how long when it is automatic, and that it is blocked otherwise', () => {
    expect(getLimitInfo(apiError(403, { code: 'IP_BLOCKED', message: 'x', retryAfterSeconds: 120 }))?.message).toBe(
      'Too many requests from your network. Try again in 2 minutes.',
    );
    expect(getLimitInfo(apiError(403, { code: 'IP_BLOCKED', message: 'x' }))?.message).toBe(
      'Access from your network is blocked.',
    );
  });

  it('anything else is not a limit', () => {
    expect(getLimitInfo(apiError(401, { code: 'UNAUTHORIZED', message: 'x' }))).toBeNull();
    expect(getLimitInfo(apiError(403, { code: 'ACCOUNT_DEACTIVATED', message: 'x' }))).toBeNull();
    expect(getLimitInfo(new Error('boom'))).toBeNull();
    expect(isLimitError(apiError(500))).toBe(false);
    expect(isLimitError(apiError(429))).toBe(true);
  });
});

describe('formatWait', () => {
  it.each([
    [0, '1 second'],
    [1, '1 second'],
    [45, '45 seconds'],
    [59.2, '1 minute'],
    [60, '1 minute'],
    [61, '2 minutes'],
  ])('%s s -> %s', (seconds, text) => {
    expect(formatWait(seconds)).toBe(text);
  });
});

describe('getFieldErrors (422 VALIDATION_FAILED)', () => {
  it('maps each field to its first message', () => {
    const error = apiError(422, {
      code: 'VALIDATION_FAILED',
      message: 'Please check these fields: firstName, email',
      fields: [
        { field: 'firstName', message: 'First name must be at least 2 characters' },
        { field: 'firstName', message: 'second message is ignored' },
        { field: 'email', message: 'Invalid email address' },
      ],
    });
    expect(getFieldErrors(error)).toEqual({
      firstName: 'First name must be at least 2 characters',
      email: 'Invalid email address',
    });
  });

  it('is empty for any other error', () => {
    expect(getFieldErrors(apiError(400, { code: 'BAD_REQUEST', message: 'x', fields: [{ field: 'a', message: 'b' }] }))).toEqual({});
    expect(getFieldErrors(new Error('x'))).toEqual({});
  });

  it('field names become plain own keys, never prototype setters', () => {
    const out = getFieldErrors(
      apiError(422, { code: 'VALIDATION_FAILED', message: 'x', fields: [{ field: '__proto__', message: 'm' }] }),
    );
    expect(Object.prototype.hasOwnProperty.call(out, '__proto__')).toBe(true);
    expect(({} as Record<string, unknown>).m).toBeUndefined();
  });
});

describe('getErrorMessage and getErrorCode', () => {
  it('prefers the server message, then a network hint, then the error message', () => {
    expect(getErrorMessage(apiError(400, { code: 'X', message: 'Server says no' }))).toBe('Server says no');
    expect(getErrorMessage(new AxiosError('Network Error', 'ERR_NETWORK'))).toBe('Network error. Check your connection.');
    expect(getErrorMessage(new Error('plain'))).toBe('plain');
    expect(getErrorMessage('?')).toBe('An unexpected error occurred');
    expect(getErrorCode(apiError(403, { code: 'ACCOUNT_DEACTIVATED', message: 'x' }))).toBe('ACCOUNT_DEACTIVATED');
    expect(getErrorCode(new Error('x'))).toBeUndefined();
  });
});
