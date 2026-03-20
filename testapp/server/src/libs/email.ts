import { Resend } from 'resend';
import { env } from '@config/env.js';
import { logger } from '@libs/logger.js';
import { InternalError } from '@shared/errors/errors.js';

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

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail({ to, subject, html }: SendEmailOptions): Promise<void> {
  const client = getResendClient();

  const { error } = await client.emails.send({
    from: env.RESEND_FROM_EMAIL,
    to,
    subject,
    html,
  });

  if (error) {
    logger.error({ emailError: error.message, to }, '[EMAIL] Failed to send email');
    throw new InternalError('Failed to send email');
  }

  logger.info({ to }, '[EMAIL] Email sent successfully');
}
