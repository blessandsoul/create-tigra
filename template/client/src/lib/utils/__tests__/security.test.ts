import { describe, expect, it } from 'vitest';

import { getSafeRedirectPath, isSafeUrl } from '../security';

describe('getSafeRedirectPath (the ?from= value after sign-in)', () => {
  it.each([
    ['/dashboard', '/dashboard'],
    ['/admin/users?page=2#top', '/admin/users?page=2#top'],
    ['/a/../b', '/b'],
  ])('keeps a same-site path: %s', (input, expected) => {
    expect(getSafeRedirectPath(input)).toBe(expected);
  });

  it.each([
    ['nothing', undefined],
    ['empty', ''],
    ['no leading slash', 'dashboard'],
    ['protocol-relative', '//evil.com'],
    ['absolute URL', 'https://evil.com/x'],
    ['backslash (browsers read it as a slash)', '/\\evil.com'],
    // Caught only by the character rule: the URL parse alone would quietly turn it into /foo/bar.
    ['backslash inside a path', '/foo\\bar'],
    ['tab inside', '/\t/evil.com'],
    ['newline inside', '/\n/evil.com'],
    ['dot segments that resolve to //', '/..//evil.com'],
    ['encoded dot segments', '/%2e%2e//evil.com'],
  ])('refuses %s', (_name, input) => {
    expect(getSafeRedirectPath(input as string | undefined)).toBeUndefined();
  });
});

describe('isSafeUrl', () => {
  it.each(['https://example.com', 'http://example.com/a', 'mailto:a@example.com'])('allows %s', (url) => {
    expect(isSafeUrl(url)).toBe(true);
  });

  it.each(['javascript:alert(1)', 'data:text/html,<b>x</b>', 'not a url', 'vbscript:x'])('refuses %s', (url) => {
    expect(isSafeUrl(url)).toBe(false);
  });
});
