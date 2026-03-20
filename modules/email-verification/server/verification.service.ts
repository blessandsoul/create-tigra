import crypto from 'node:crypto';
import { signAccessToken, generateRefreshToken, getRefreshTokenExpiresAt } from '@libs/auth.js';
import { getRedis } from '@libs/redis.js';
import { sendEmail } from '@libs/email.js';
import { logger } from '@libs/logger.js';
import { env } from '@config/env.js';
import {
  BadRequestError,
  NotFoundError,
} from '@shared/errors/errors.js';
import * as authRepo from './auth.repo.js';
import { sessionRepository } from './session.repo.js';
import { sanitizeUser } from './auth.service.js';

import type { AuthResult } from './auth.service.js';

const VERIFICATION_TTL = 3600; // 1 hour in seconds
const VERIFICATION_PREFIX = 'verify:';
const VERIFICATION_USER_PREFIX = 'verify-user:';

/**
 * Send a verification email to a user.
 * Public endpoint — accepts email, silent return if user not found (prevents enumeration).
 * Also called internally by the register flow for auto-sending.
 */
export async function sendVerification(email: string): Promise<void> {
  const user = await authRepo.findUserByEmail(email);

  // Silent return if user not found — prevents email enumeration (same pattern as forgotPassword)
  if (!user) return;

  // Silent return if already verified — no need to reveal account status
  if (user.isActive) return;

  const redis = getRedis();

  // Invalidate any existing verification token for this user
  const existingToken = await redis.get(`${VERIFICATION_USER_PREFIX}${user.id}`);
  if (existingToken) {
    await redis.del(`${VERIFICATION_PREFIX}${existingToken}`);
    await redis.del(`${VERIFICATION_USER_PREFIX}${user.id}`);
  }

  // Generate secure token and store in Redis with 1 hour TTL
  const token = crypto.randomBytes(32).toString('hex');

  await redis.set(`${VERIFICATION_PREFIX}${token}`, user.id, 'EX', VERIFICATION_TTL);
  await redis.set(`${VERIFICATION_USER_PREFIX}${user.id}`, token, 'EX', VERIFICATION_TTL);

  // Build verification URL and send email
  const verifyUrl = `${env.CLIENT_URL}/verify-account?token=${token}`;
  const safeName = user.firstName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  try {
    await sendEmail({
      to: user.email,
      subject: 'Verify your account',
      html: `
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f3ee; padding: 40px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
          <tr>
            <td align="center">
              <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 480px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06); border-left: 4px solid #c15f3c;">
                <tr>
                  <td style="padding: 40px;">
                    <p style="margin: 0 0 20px; font-size: 12px; font-weight: 600; color: #c15f3c; text-transform: uppercase; letter-spacing: 1.5px;">Account Verification</p>
                    <h1 style="margin: 0 0 8px; font-size: 22px; font-weight: 600; color: #1a170f;">Verify your account</h1>
                    <p style="margin: 0 0 28px; font-size: 15px; color: #6b6560; line-height: 1.6;">
                      Hi ${safeName}, please verify your email address to activate your account and get started.
                    </p>
                    <a href="${verifyUrl}" style="display: inline-block; background-color: #1a170f; color: #ffffff; padding: 14px 32px; border-radius: 10px; text-decoration: none; font-size: 15px; font-weight: 600;">
                      Verify account &rarr;
                    </a>
                    <p style="margin: 28px 0 0; font-size: 13px; color: #9b958e; line-height: 1.6;">
                      This link expires in 1 hour. If you didn't create an account, you can safely ignore this email.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 0 40px 32px;">
                    <div style="border-top: 1px solid #e8e6e1; padding-top: 20px;">
                      <p style="margin: 0; font-size: 12px; color: #b5b0a8; line-height: 1.5;">
                        If the button doesn't work, copy this link:<br/>
                        <a href="${verifyUrl}" style="color: #c15f3c; text-decoration: underline; word-break: break-all;">${verifyUrl}</a>
                      </p>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      `,
    });

    logger.info({ userId: user.id }, '[AUTH] Verification email sent');
  } catch (error) {
    // Log but don't throw — prevents leaking email existence via 500 vs 200
    logger.error({ userId: user.id, err: error }, '[AUTH] Failed to send verification email');
  }
}

export async function verifyAccount(
  token: string,
  deviceInfo?: string,
  ipAddress?: string,
): Promise<AuthResult> {
  const redis = getRedis();

  // Atomic get-and-delete to prevent token reuse via concurrent requests
  const userId = await redis.getDel(`${VERIFICATION_PREFIX}${token}`);
  if (!userId) {
    throw new BadRequestError('Invalid or expired verification token', 'INVALID_VERIFICATION_TOKEN');
  }

  const user = await authRepo.findUserById(userId);
  if (!user) {
    throw new NotFoundError('User not found', 'USER_NOT_FOUND');
  }

  // Activate the user account
  await authRepo.activateUser(userId);

  // Clean up the reverse-lookup key
  await redis.del(`${VERIFICATION_USER_PREFIX}${userId}`);

  // Generate tokens and create session (same pattern as login)
  const accessToken = signAccessToken({
    userId: user.id,
    role: user.role,
  });
  const refreshToken = generateRefreshToken();
  const refreshTokenExpiresAt = getRefreshTokenExpiresAt();

  const session = await sessionRepository.createSession({
    userId: user.id,
    deviceInfo,
    ipAddress,
    expiresAt: refreshTokenExpiresAt,
  });

  await authRepo.createRefreshToken({
    token: refreshToken,
    userId: user.id,
    sessionId: session.id,
    expiresAt: refreshTokenExpiresAt,
  });

  logger.info({ userId }, '[AUTH] Account verified');

  // Send welcome email (best-effort — don't fail verification if email fails)
  const safeName = user.firstName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const dashboardUrl = `${env.CLIENT_URL}/dashboard`;

  try {
    await sendEmail({
      to: user.email,
      subject: 'Welcome — your account is verified!',
      html: `
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f3ee; padding: 40px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
          <tr>
            <td align="center">
              <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 480px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06); border-left: 4px solid #c15f3c;">
                <tr>
                  <td style="padding: 40px;">
                    <p style="margin: 0 0 20px; font-size: 12px; font-weight: 600; color: #c15f3c; text-transform: uppercase; letter-spacing: 1.5px;">Welcome</p>
                    <h1 style="margin: 0 0 8px; font-size: 22px; font-weight: 600; color: #1a170f;">You're all set!</h1>
                    <p style="margin: 0 0 28px; font-size: 15px; color: #6b6560; line-height: 1.6;">
                      Hi ${safeName}, your account has been verified. You can now access all features of the app.
                    </p>
                    <a href="${dashboardUrl}" style="display: inline-block; background-color: #1a170f; color: #ffffff; padding: 14px 32px; border-radius: 10px; text-decoration: none; font-size: 15px; font-weight: 600;">
                      Go to dashboard &rarr;
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      `,
    });
  } catch (error) {
    logger.error({ userId, err: error }, '[AUTH] Failed to send welcome email');
  }

  return {
    user: sanitizeUser({ ...user, isActive: true }),
    accessToken,
    refreshToken,
  };
}
