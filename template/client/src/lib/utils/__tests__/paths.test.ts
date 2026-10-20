import { describe, expect, it } from 'vitest';

import { isAuthPath, isProtectedPath, isUnderPath } from '../paths';

describe('isUnderPath (whole path segments)', () => {
  it.each([
    ['/admin', '/admin', true],
    ['/admin/users', '/admin', true],
    ['/admin/users/1', '/admin', true],
    ['/administrator', '/admin', false],
    ['/admin-old', '/admin', false],
    ['/', '/admin', false],
    ['/anything', '/', true],
  ])('%s under %s -> %s', (pathname, base, expected) => {
    expect(isUnderPath(pathname, base)).toBe(expected);
  });
});

describe('the shipped lists', () => {
  it.each([
    ['/dashboard', true],
    ['/dashboard/settings', true],
    ['/profile', true],
    ['/admin/sessions', true],
    ['/profile-public', false],
    ['/dashboards', false],
    ['/', false],
    ['/login', false],
  ])('protected %s -> %s', (pathname, expected) => {
    expect(isProtectedPath(pathname)).toBe(expected);
  });

  it.each([
    ['/login', true],
    ['/register', true],
    ['/reset-password', true],
    ['/verify-account', true],
    ['/login-help', false],
    ['/dashboard', false],
  ])('sign-in page %s -> %s', (pathname, expected) => {
    expect(isAuthPath(pathname)).toBe(expected);
  });
});
