// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { hasSessionMarker } from '../session-marker';

describe('hasSessionMarker', () => {
  afterEach(() => {
    document.cookie = 'auth_session=; Max-Age=0; path=/';
  });

  it.each([
    ['auth_session=1', true],
    ['theme=dark; auth_session=1; other=x', true],
    ['auth_session=', false],
    ['xauth_session=1', false],
    ['auth_session_old=1', false],
    ['', false],
  ])('%j -> %s', (cookies, expected) => {
    expect(hasSessionMarker(cookies)).toBe(expected);
  });

  it("reads this browser's cookies by default", () => {
    expect(hasSessionMarker()).toBe(false);
    document.cookie = 'auth_session=1; path=/';
    expect(hasSessionMarker()).toBe(true);
  });
});
