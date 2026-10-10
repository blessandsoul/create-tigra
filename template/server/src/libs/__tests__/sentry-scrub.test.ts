import { describe, it, expect } from 'vitest';
import type { Event } from '@sentry/node';
import { scrubSentryEvent } from '../observability/sentry.js';

// Error events must never carry passwords, tokens or cookies to Sentry.

describe('scrubSentryEvent', () => {
  it('removes request body, cookies, auth headers and query strings', () => {
    const event: Event = {
      request: {
        url: 'https://api.example.test/api/v1/auth/reset-password?token=secret-reset-token',
        method: 'POST',
        data: '{"email":"a@example.test","password":"Plaintext-Passw0rd"}',
        cookies: { access_token: 'jwt-value', refresh_token: 'refresh-value' },
        query_string: 'token=secret-reset-token',
        headers: {
          Cookie: 'access_token=jwt-value; refresh_token=refresh-value',
          authorization: 'Bearer jwt-value',
          'user-agent': 'vitest',
        },
      },
      breadcrumbs: [
        { category: 'http', data: { url: 'https://x.test/verify-account?token=abc', 'http.query': 'token=abc' } },
      ],
    };

    const scrubbed = scrubSentryEvent(event);
    const serialized = JSON.stringify(scrubbed);

    expect(serialized).not.toContain('Plaintext-Passw0rd');
    expect(serialized).not.toContain('jwt-value');
    expect(serialized).not.toContain('refresh-value');
    expect(serialized).not.toContain('secret-reset-token');
    expect(serialized).not.toContain('token=abc');
    // Useful, non-secret context survives
    expect(scrubbed.request?.method).toBe('POST');
    expect(scrubbed.request?.url).toBe('https://api.example.test/api/v1/auth/reset-password');
    expect(scrubbed.request?.headers?.['user-agent']).toBe('vitest');
  });

  it('strips tokens from the Referer header, trace data, span attributes and the transaction name', () => {
    // The browser SDK copies the page URL and the Referer into request headers
    // and span/trace attributes; reset/verify pages carry ?token=… there.
    const event: Event = {
      transaction: '/verify-account?token=txn-secret',
      request: { headers: { Referer: 'https://app.example.test/reset-password?token=referer-secret' } },
      contexts: {
        trace: {
          trace_id: 't',
          span_id: 's',
          data: {
            'url.full': 'https://app.example.test/reset-password?token=trace-secret',
            'http.request.header.referer': 'https://app.example.test/verify-account?token=trace-ref-secret',
            'http.query': 'token=trace-query-secret',
          },
        },
      },
      spans: [
        {
          span_id: 'x',
          trace_id: 't',
          start_timestamp: 0,
          data: { 'http.request.header.referer': 'https://app.example.test/x?token=span-secret' },
        },
      ],
    };

    const serialized = JSON.stringify(scrubSentryEvent(event));

    for (const secret of ['txn-secret', 'referer-secret', 'trace-secret', 'trace-ref-secret', 'trace-query-secret', 'span-secret']) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain('https://app.example.test/reset-password');
  });

  it('leaves an event without request data untouched', () => {
    const event: Event = { message: 'boom' };
    expect(scrubSentryEvent(event)).toEqual({ message: 'boom' });
  });
});
