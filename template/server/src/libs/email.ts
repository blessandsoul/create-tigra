/**
 * Sending email through Resend.
 *
 * - A send gives up after 10 s. The Resend SDK calls fetch with no timeout, so
 *   a hung Resend used to hold the request that sends (forgot-password waits
 *   for it) open for Node's ~5 minute default. Callers catch and log failures.
 * - Recipient addresses are logged masked ('an***@example.com'): enough to
 *   trace one email while debugging, never the full address in the logs.
 * - RESEND_BASE_URL (read by the SDK) points sends at a local stub in tests.
 */
import { Resend } from 'resend';
import { env } from '@config/env.js';
import { logger } from '@libs/logger.js';
import { InternalError } from '@shared/errors/errors.js';

const SEND_TIMEOUT_MS = 10_000;

let resendClient: Resend | null = null;

function getResendClient(): Resend {
  if (!resendClient) {
    if (!env.RESEND_API_KEY) {
      throw new InternalError('Email service not configured — set RESEND_API_KEY in .env');
    }
    resendClient = new Resend(env.RESEND_API_KEY);
  }
  return resendClient;
}

/**
 * An address as it may appear in logs: the first two characters of the local
 * part (one if it has only one), then *** and the domain. Anything that is not
 * an address becomes '***'.
 */
export function maskEmail(address: string): string {
  const at = typeof address === 'string' ? address.lastIndexOf('@') : -1;
  if (at < 1 || at === address.length - 1) return '***';
  const local = address.slice(0, at);
  return `${local.slice(0, local.length === 1 ? 1 : 2)}***@${address.slice(at + 1)}`;
}

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

class EmailTimeout extends Error {}

export async function sendEmail({ to, subject, html }: SendEmailOptions): Promise<void> {
  const client = getResendClient();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new EmailTimeout()), SEND_TIMEOUT_MS);
  });

  let result: Awaited<ReturnType<typeof client.emails.send>>;
  try {
    // The fetch may still finish in the background; we stop waiting for it.
    result = await Promise.race([client.emails.send({ from: env.RESEND_FROM_EMAIL, to, subject, html }), timeout]);
  } catch (error) {
    if (error instanceof EmailTimeout) {
      logger.error({ to: maskEmail(to), timeoutMs: SEND_TIMEOUT_MS }, '[EMAIL] Sending timed out');
      throw new InternalError('Email send timed out');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (result.error) {
    logger.error({ emailError: result.error.message, to: maskEmail(to) }, '[EMAIL] Failed to send email');
    throw new InternalError('Failed to send email');
  }

  logger.info({ to: maskEmail(to) }, '[EMAIL] Email sent successfully');
}
