/**
 * sendEmail (../email.ts) with Resend mocked: a hung Resend gives up after
 * 10 s, and no log line ever carries a full recipient address.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@libs/logger.js';

const send = vi.hoisted(() => vi.fn());
vi.mock('resend', () => ({
  Resend: class {
    emails = { send };
  },
}));
vi.mock('@config/env.js', () => ({ env: { RESEND_API_KEY: 're_test', RESEND_FROM_EMAIL: 'noreply@example.test' } }));
vi.mock('@libs/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { sendEmail, maskEmail } = await import('../email.js');
const TO = 'anna.smith@example.test';
const mail = { to: TO, subject: 'Hi', html: '<p>Hi</p>' };
const logged = (): string => JSON.stringify([...vi.mocked(logger.info).mock.calls, ...vi.mocked(logger.error).mock.calls]);

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('maskEmail', () => {
  it.each([
    ['anna@example.com', 'an***@example.com'],
    ['a@example.com', 'a***@example.com'],
    ['not-an-address', '***'],
    ['@example.com', '***'],
    ['anna@', '***'],
  ])('%s → %s', (address, masked) => {
    expect(maskEmail(address)).toBe(masked);
  });
});

describe('sendEmail', () => {
  it('sends and logs the recipient masked', async () => {
    send.mockResolvedValue({ data: { id: 'e1' }, error: null });
    await sendEmail(mail);
    expect(send).toHaveBeenCalledWith({ from: 'noreply@example.test', ...mail });
    expect(logger.info).toHaveBeenCalledWith({ to: 'an***@example.test' }, '[EMAIL] Email sent successfully');
    expect(logged()).not.toContain(TO);
  });

  it('a Resend error is logged masked and thrown as a generic InternalError', async () => {
    send.mockResolvedValue({ data: null, error: { message: 'invalid from address' } });
    await expect(sendEmail(mail)).rejects.toMatchObject({ statusCode: 500, message: 'Failed to send email' });
    expect(logged()).not.toContain(TO);
  });

  it('gives up after 10 s when Resend hangs', async () => {
    vi.useFakeTimers();
    send.mockReturnValue(new Promise(() => undefined)); // never settles
    const pending = sendEmail(mail);
    const outcome = pending.then(() => 'sent', (error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(await Promise.race([outcome, Promise.resolve('still waiting')])).toBe('still waiting');
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toBe('Email send timed out');
    expect(logger.error).toHaveBeenCalledWith({ to: 'an***@example.test', timeoutMs: 10_000 }, '[EMAIL] Sending timed out');
    expect(logged()).not.toContain(TO);
  });
});
