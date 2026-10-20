import { describe, expect, it } from 'vitest';

import { setUser } from '@/features/auth/store/authSlice';
import type { IUser } from '@/features/auth/types/auth.types';

import { makeStore } from '../index';

const user: IUser = {
  id: 'u1',
  email: 'a@example.test',
  firstName: 'Ana',
  lastName: 'Test',
  role: 'USER',
  isActive: true,
  emailVerifiedAt: null,
  avatarUrl: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('makeStore', () => {
  it('without a session marker the visitor is signed out from the first render', () => {
    expect(makeStore().getState().auth).toEqual({
      user: null,
      isAuthenticated: false,
      isInitializing: false,
      isLoggingOut: false,
    });
  });

  it('with a session marker the user is unknown until the "who am I" check answers', () => {
    const auth = makeStore({ hasSession: true }).getState().auth;
    expect(auth.isInitializing).toBe(true);
    expect(auth.isAuthenticated).toBe(false);
  });

  it('every store is its own: one visitor signing in never shows in another', () => {
    const a = makeStore({ hasSession: true });
    const b = makeStore({ hasSession: true });
    a.dispatch(setUser(user));
    expect(a.getState().auth.user?.firstName).toBe('Ana');
    expect(b.getState().auth.user).toBeNull();
  });
});
