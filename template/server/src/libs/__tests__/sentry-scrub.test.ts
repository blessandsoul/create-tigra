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

  it('leaves an event without request data untouched', () => {
    const event: Event = { message: 'boom' };
    expect(scrubSentryEvent(event)).toEqual({ message: 'boom' });
  });
});
