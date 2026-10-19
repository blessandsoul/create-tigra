/**
 * Log redaction (REDACT_PATHS in src/libs/logger.ts), checked on a fresh pino
 * instance with the same redact settings writing to memory, so the result does
 * not depend on the pretty transport used outside production.
 */
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { REDACT_PATHS } from '@libs/logger.js';

function logged(obj: Record<string, unknown>): string {
  const lines: string[] = [];
  const log = pino({ redact: { paths: REDACT_PATHS, remove: true } }, { write: (line: string) => lines.push(line) });
  log.info(obj);
  return lines.join('');
}

const SECRET = 'leak-canary-9W4K';

describe('log redaction', () => {
  it('removes secrets at the top level and one, two and three levels deep', () => {
    for (const obj of [
      { password: SECRET },
      { body: { newPassword: SECRET } },
      { input: { user: { accessToken: SECRET } } },
      { a: { b: { c: { refresh_token: SECRET } } } },
    ]) {
      expect(logged(obj), JSON.stringify(obj)).not.toContain(SECRET);
    }
  });

  it('removes secrets inside arrays', () => {
    expect(logged({ items: [{ apiKey: SECRET }] })).not.toContain(SECRET);
  });

  it('removes secret headers, raw and under req', () => {
    const out = logged({
      req: { headers: { authorization: `Bearer ${SECRET}`, 'x-origin-verify': SECRET, host: 'api.example.test' } },
      headers: { cookie: `access_token=${SECRET}`, 'set-cookie': SECRET },
    });
    expect(out).not.toContain(SECRET);
    expect(out).toContain('api.example.test');
  });

  it('keeps ordinary fields', () => {
    const out = logged({ userId: 'u-1', email: 'a@example.test', tokenCount: 3 });
    expect(out).toContain('u-1');
    expect(out).toContain('a@example.test');
    expect(out).toContain('"tokenCount":3');
  });
});
