import { describe, it, expect, vi, afterEach } from 'vitest';
import { env as realEnv } from '@config/env.js';
import {
  RATE_LIMITS,
  DEFAULT_LIMIT,
  EMAIL_PER_ADDRESS,
  RateLimitConfigError,
  parseOverrides,
  parseWindow,
  unknownOverrideNames,
} from '../rate-limit.config.js';

const MIN = 60_000;
const HOUR = 60 * MIN;

/**
 * The shipped defaults (Tornike, 2026-10-19). Changing a limit means changing it here
 * too, on purpose. The two email-module entries exist only in projects scaffolded with
 * (or patched to add) email verification.
 */
const EXPECTED: Record<string, { max: number; timeWindow: number }> = {
  AUTH_REGISTER: { max: 40, timeWindow: HOUR },
  AUTH_LOGIN: { max: 100, timeWindow: 15 * MIN },
  AUTH_LOGOUT: { max: 200, timeWindow: 15 * MIN },
  AUTH_REFRESH: { max: 200, timeWindow: 15 * MIN },
  AUTH_ME: { max: 200, timeWindow: MIN },
  AUTH_SESSIONS: { max: 30, timeWindow: MIN },
  AUTH_LOGOUT_ALL: { max: 10, timeWindow: 15 * MIN },
  AUTH_FORGOT_PASSWORD: { max: 20, timeWindow: 15 * MIN },
  AUTH_RESET_PASSWORD: { max: 100, timeWindow: 15 * MIN },
  USERS_UPDATE_PROFILE: { max: 30, timeWindow: MIN },
  USERS_CHANGE_PASSWORD: { max: 10, timeWindow: 15 * MIN },
  USERS_DELETE_ACCOUNT: { max: 10, timeWindow: MIN },
  USERS_UPLOAD_AVATAR: { max: 10, timeWindow: MIN },
  USERS_DELETE_AVATAR: { max: 30, timeWindow: MIN },
  USERS_GET_AVATAR: { max: 100, timeWindow: MIN },
  FILES_GET: { max: 100, timeWindow: MIN },
  ADMIN_DEFAULT: { max: 30, timeWindow: MIN },
};
const EXPECTED_EMAIL_MODULE = {
  AUTH_SEND_VERIFICATION: { max: 10, timeWindow: 15 * MIN },
  AUTH_VERIFY_ACCOUNT: { max: 10, timeWindow: 15 * MIN },
};

describe('shipped rate limits', () => {
  it('match the agreed table exactly, entry by entry', () => {
    const limits = RATE_LIMITS as Record<string, unknown>;
    const hasEmailModule = 'AUTH_SEND_VERIFICATION' in limits;
    const expected = hasEmailModule ? { ...EXPECTED, ...EXPECTED_EMAIL_MODULE } : EXPECTED;
    expect(Object.keys(limits).sort()).toEqual(Object.keys(expected).sort());
    for (const [name, limit] of Object.entries(expected)) {
      expect({ name, ...(limits[name] as object) }).toEqual({ name, ...limit });
    }
  });

  it('default limit is 200 per minute, email cap is 3 per address per hour', () => {
    expect(DEFAULT_LIMIT).toEqual({ max: 200, timeWindow: MIN });
    expect(EMAIL_PER_ADDRESS).toEqual({ max: 3, timeWindow: HOUR });
  });
});

describe('RATE_LIMIT_OVERRIDES parsing', () => {
  it('parses windows in seconds, minutes and hours', () => {
    expect(parseWindow('30s')).toBe(30_000);
    expect(parseWindow('15m')).toBe(15 * MIN);
    expect(parseWindow('1h')).toBe(HOUR);
  });

  it('rejects malformed windows', () => {
    for (const bad of ['15', '0m', '1d', '1.5h', 'm', '-1m']) {
      expect(() => parseWindow(bad)).toThrow(RateLimitConfigError);
    }
  });

  it('parses a list, ignoring spaces and empty items', () => {
    const map = parseOverrides(' AUTH_LOGIN=50/15m , DEFAULT=300/1m,,EMAIL_PER_ADDRESS=5/1h ');
    expect(Object.fromEntries(map)).toEqual({
      AUTH_LOGIN: { max: 50, timeWindow: 15 * MIN },
      DEFAULT: { max: 300, timeWindow: MIN },
      EMAIL_PER_ADDRESS: { max: 5, timeWindow: HOUR },
    });
    expect(parseOverrides(undefined).size).toBe(0);
    expect(parseOverrides('  ').size).toBe(0);
  });

  it('rejects bad entries with a message that names them', () => {
    expect(() => parseOverrides('AUTH_LOGIN=abc')).toThrow(/AUTH_LOGIN=abc/);
    expect(() => parseOverrides('AUTH_LOGIN=0/1m')).toThrow(/invalid max/);
    expect(() => parseOverrides('auth_login=5/1m')).toThrow(/expected NAME=MAX\/WINDOW/);
    expect(() => parseOverrides('AUTH_LOGIN=5/1m,AUTH_LOGIN=6/1m')).toThrow(/more than once/);
    expect(() => parseOverrides('AUTH_LOGIN=5/1d')).toThrow(/invalid window/);
  });

  it('finds names that match no limit', () => {
    const map = parseOverrides('AUTH_LOGN=5/1m,DEFAULT=1/1m');
    expect(unknownOverrideNames(map, ['AUTH_LOGIN', 'DEFAULT'])).toEqual(['AUTH_LOGN']);
  });
});

describe('rate-limit.config at boot', () => {
  afterEach(() => {
    vi.doUnmock('@config/env.js');
    vi.doUnmock('@libs/logger.js');
    vi.restoreAllMocks();
    vi.resetModules();
    delete process.env.RATE_LIMIT_AUTH_LOGIN_MAX;
  });

  async function loadWith(overrides: Partial<typeof realEnv>): Promise<typeof import('../rate-limit.config.js')> {
    vi.resetModules();
    vi.doMock('@config/env.js', () => ({ env: { ...realEnv, ...overrides } }));
    return import('../rate-limit.config.js');
  }

  it('applies an override, then the multiplier on top', async () => {
    const mod = await loadWith({ RATE_LIMIT_OVERRIDES: 'AUTH_LOGIN=5/30s,DEFAULT=300/2m', RATE_LIMIT_MULTIPLIER: 2 });
    expect(mod.RATE_LIMITS.AUTH_LOGIN).toEqual({ max: 10, timeWindow: 30_000 });
    expect(mod.DEFAULT_LIMIT).toEqual({ max: 600, timeWindow: 2 * MIN });
    expect(mod.RATE_LIMITS.AUTH_REGISTER).toEqual({ max: 80, timeWindow: HOUR }); // multiplier only
  });

  it('turns every limit into 1,000,000 when RATE_LIMIT_ENABLED is off', async () => {
    const mod = await loadWith({ RATE_LIMIT_ENABLED: false });
    expect(mod.RATE_LIMITS.AUTH_LOGIN.max).toBe(1_000_000);
    expect(mod.EMAIL_PER_ADDRESS.max).toBe(1_000_000);
  });

  it('stops the server on an unknown name, listing the valid names', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(loadWith({ RATE_LIMIT_OVERRIDES: 'AUTH_LOGN=5/1m' })).rejects.toThrow('exit 1');
    expect(exit).toHaveBeenCalledWith(1);
    const message = String(error.mock.calls[0]?.[0]);
    expect(message).toContain('unknown name(s): AUTH_LOGN');
    expect(message).toContain('Valid names: AUTH_REGISTER, AUTH_LOGIN');
    expect(message).toContain('DEFAULT, EMAIL_PER_ADDRESS');
  });

  it('stops the server on a malformed value', async () => {
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(loadWith({ RATE_LIMIT_OVERRIDES: 'AUTH_LOGIN=lots' })).rejects.toThrow('exit 1');
    expect(String(error.mock.calls[0]?.[0])).toContain('Invalid RATE_LIMIT_OVERRIDES: invalid entry "AUTH_LOGIN=lots"');
  });

  it('warns once that a removed variable is ignored, and ignores it', async () => {
    const warn = vi.fn();
    vi.doMock('@libs/logger.js', () => ({ logger: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
    process.env.RATE_LIMIT_AUTH_LOGIN_MAX = '10';
    const mod = await loadWith({});
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('RATE_LIMIT_AUTH_LOGIN_MAX is no longer read');
    expect(mod.RATE_LIMITS.AUTH_LOGIN.max).toBe(100);
  });
});
