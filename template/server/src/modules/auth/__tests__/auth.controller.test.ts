/**
 * The refresh controller clears the auth cookies when a session is dead,
 * EXCEPT when the refresh lost a race with a parallel one (two tabs): that
 * browser already holds the winner's fresh cookies (auth.service.ts refresh()).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { UnauthorizedError } from '@shared/errors/errors.js';
import { clearAuthCookies, setAuthCookies } from '@libs/cookies.js';
import * as authService from '../auth.service.js';
import { refresh } from '../auth.controller.js';

vi.mock('@libs/cookies.js', () => ({ clearAuthCookies: vi.fn(), setAuthCookies: vi.fn() }));
vi.mock('../auth.service.js', () => ({ refresh: vi.fn(), REFRESH_TOKEN_ROTATED: 'REFRESH_TOKEN_ROTATED' }));

const request = { cookies: { refresh_token: 'rt' } } as unknown as FastifyRequest;
const reply = { send: vi.fn() } as unknown as FastifyReply;

describe('auth.controller refresh', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps the cookies when the refresh lost a race with a parallel one', async () => {
    vi.mocked(authService.refresh).mockRejectedValue(new UnauthorizedError('lost race', 'REFRESH_TOKEN_ROTATED'));
    await expect(refresh(request, reply)).rejects.toMatchObject({ code: 'REFRESH_TOKEN_ROTATED' });
    expect(clearAuthCookies).not.toHaveBeenCalled();
  });

  it('still clears the cookies when the session is dead', async () => {
    vi.mocked(authService.refresh).mockRejectedValue(new UnauthorizedError('gone', 'INVALID_REFRESH_TOKEN'));
    await expect(refresh(request, reply)).rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });
    expect(clearAuthCookies).toHaveBeenCalledWith(reply);
  });

  it('sets the new cookies on success', async () => {
    vi.mocked(authService.refresh).mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });
    await refresh(request, reply);
    expect(setAuthCookies).toHaveBeenCalledWith(reply, 'a', 'r');
  });
});
