import type { FastifyRequest, FastifyReply } from 'fastify';
import { successResponse } from '@shared/responses/successResponse.js';
import { UnauthorizedError } from '@shared/errors/errors.js';
import { setAuthCookies, clearAuthCookies } from '@libs/cookies.js';
import type {
  RegisterInput,
  LoginInput,
} from './auth.schemas.js';
import * as authService from './auth.service.js';

export async function register(
  request: FastifyRequest<{ Body: RegisterInput }>,
  reply: FastifyReply,
): Promise<void> {
  const deviceInfo = request.headers['user-agent'];
  const ipAddress = request.ip;

  const result = await authService.register(request.body, deviceInfo, ipAddress);

  setAuthCookies(reply, result.accessToken, result.refreshToken);
  reply.status(201).send(successResponse('User registered successfully', { user: result.user }));
}

export async function login(
  request: FastifyRequest<{ Body: LoginInput }>,
  reply: FastifyReply,
): Promise<void> {
  const deviceInfo = request.headers['user-agent'];
  const ipAddress = request.ip;

  const result = await authService.login(request.body, deviceInfo, ipAddress);

  setAuthCookies(reply, result.accessToken, result.refreshToken);
  reply.send(successResponse('Logged in successfully', { user: result.user }));
}

export async function refresh(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const refreshToken = request.cookies.refresh_token;
  if (!refreshToken) {
    throw new UnauthorizedError('Refresh token not provided', 'MISSING_REFRESH_TOKEN');
  }

  const tokens = await authService.refresh(refreshToken);

  setAuthCookies(reply, tokens.accessToken, tokens.refreshToken);
  reply.send(successResponse('Token refreshed successfully', null));
}

export async function logout(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const refreshToken = request.cookies.refresh_token;
  if (refreshToken) {
    await authService.logout(refreshToken);
  }

  clearAuthCookies(reply);
  reply.send(successResponse('Logged out successfully', null));
}

export async function me(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const user = await authService.getCurrentUser(request.user.userId);
  reply.send(successResponse('Current user retrieved', user));
}

export async function getSessions(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const sessions = await authService.getUserSessions(request.user.userId);
  reply.send(successResponse('User sessions retrieved', sessions));
}

export async function logoutAllSessions(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const count = await authService.logoutAllSessions(request.user.userId);
  clearAuthCookies(reply);
  reply.send(
    successResponse(`Successfully logged out from ${count} session(s)`, { count }),
  );
}
