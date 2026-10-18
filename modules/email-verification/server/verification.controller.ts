import type { FastifyRequest, FastifyReply } from 'fastify';
import { successResponse } from '@shared/responses/successResponse.js';
import { setAuthCookies } from '@libs/cookies.js';
import { getClientIp } from '@libs/client-ip.js';
import * as verificationService from './verification.service.js';

import type { SendVerificationInput, VerifyAccountInput } from './auth.schemas.js';

export async function sendVerification(
  request: FastifyRequest<{ Body: SendVerificationInput }>,
  reply: FastifyReply,
): Promise<void> {
  await verificationService.sendVerification(request.body.email);
  // Always return success to prevent email enumeration (same pattern as forgotPassword)
  reply.send(successResponse('If an account exists with that email, a verification link has been sent.', null));
}

export async function verifyAccount(
  request: FastifyRequest<{ Body: VerifyAccountInput }>,
  reply: FastifyReply,
): Promise<void> {
  const deviceInfo = request.headers['user-agent'];
  // Same verified address as login/register sessions (never request.ip or a raw header).
  const ipAddress = getClientIp(request);

  const result = await verificationService.verifyAccount(request.body.token, deviceInfo, ipAddress);

  setAuthCookies(reply, result.accessToken, result.refreshToken);
  reply.send(successResponse('Account verified successfully', { user: result.user }));
}
