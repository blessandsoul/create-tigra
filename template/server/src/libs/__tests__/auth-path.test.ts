import { describe, it, expect } from 'vitest';
import { isAuthPath } from '../auth-path.js';

describe('isAuthPath', () => {
  it('returns true for an auth route', () => {
    expect(isAuthPath({ url: '/api/v1/auth/login' })).toBe(true);
  });

  it('returns true when the auth route has a query string', () => {
    expect(isAuthPath({ url: '/api/v1/auth/login?next=/dashboard' })).toBe(true);
  });

  it('returns false for a non-auth route (it still feeds the auto-ban)', () => {
    expect(isAuthPath({ url: '/api/v1/widget/chat' })).toBe(false);
  });

  it('returns false for the bare /api/v1/auth prefix without a sub-path', () => {
    expect(isAuthPath({ url: '/api/v1/auth' })).toBe(false);
  });

  it('returns false for a non-auth path that only starts with "auth"', () => {
    expect(isAuthPath({ url: '/api/v1/auth-internal/health' })).toBe(false);
  });
});
