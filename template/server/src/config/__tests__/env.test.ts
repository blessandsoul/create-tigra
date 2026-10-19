/**
 * Boot-time env validation (src/config/env.ts). The module validates at import
 * and exits the process on a mistake, so every case boots it in a fresh child
 * process with an exact environment and checks the exit code and message (or
 * the parsed values it prints).
 *
 * The child runs in an empty temp directory so dotenv cannot load a developer's
 * real server/.env (dotenv never overrides variables that are already set, but
 * it would fill in the ones a case deliberately leaves out).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const tsxCli = path.join(serverRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const envModuleUrl = pathToFileURL(path.join(serverRoot, 'src', 'config', 'env.ts')).href;

/** The email-verification module adds this file (and turns verification on by default). */
const EMAIL_MODULE_INSTALLED = existsSync(path.join(serverRoot, 'src', 'modules', 'auth', 'verification.service.ts'));

const workDir = mkdtempSync(path.join(tmpdir(), 'env-validation-'));
const probe = path.join(workDir, 'probe.mts');
writeFileSync(
  probe,
  `const { env } = await import(${JSON.stringify(envModuleUrl)});\n` +
    'console.log(JSON.stringify({ RATE_LIMIT_ENABLED: env.RATE_LIMIT_ENABLED, ' +
    'REQUIRE_USER_VERIFICATION: env.REQUIRE_USER_VERIFICATION, REDIS_URL: env.REDIS_URL, ' +
    'CLIENT_URL: env.CLIENT_URL, CORS_ORIGINS: env.CORS_ORIGINS }));\n',
);
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

/** Only what node and tsx need to run on any OS; nothing from this test process's app env. */
const SYSTEM = Object.fromEntries(
  ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP', 'HOME', 'USERPROFILE'].flatMap((key) =>
    process.env[key] === undefined ? [] : [[key, process.env[key] as string]],
  ),
);

/** The only variables without a default. */
const REQUIRED = { DATABASE_URL: 'mysql://user:pass@localhost:3306/app', JWT_SECRET: 'x'.repeat(48) };
/** The smallest valid environment (verification off, so no Resend key is needed). */
const BASE = { ...REQUIRED, REQUIRE_USER_VERIFICATION: 'false' };
const PRODUCTION = { ...BASE, NODE_ENV: 'production', CORS_ORIGIN: 'https://app.example.test' };

function boot(vars: Record<string, string>): { code: number | null; out: string; err: string } {
  const result = spawnSync(process.execPath, [tsxCli, probe], {
    cwd: workDir,
    env: { ...SYSTEM, ...vars },
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

function parsed(vars: Record<string, string>): Record<string, unknown> {
  const result = boot(vars);
  expect(result.code, result.err).toBe(0);
  return JSON.parse(result.out.trim().split('\n').pop() as string) as Record<string, unknown>;
}

describe('env validation at boot', { timeout: 60_000 }, () => {
  it('refuses to start in production without REDIS_URL', () => {
    const result = boot(PRODUCTION);
    expect(result.code).toBe(1);
    expect(result.err).toContain('REDIS_URL is required in production');
  });

  it('starts in production with REDIS_URL and keeps its value', () => {
    expect(parsed({ ...PRODUCTION, REDIS_URL: 'redis://cache.internal:6379' }).REDIS_URL).toBe(
      'redis://cache.internal:6379',
    );
  });

  it('defaults REDIS_URL to the local Redis outside production', () => {
    expect(parsed({ ...BASE, NODE_ENV: 'development' }).REDIS_URL).toBe('redis://localhost:6379');
  });

  describe('CORS_ORIGIN (bare origins only)', () => {
    const WITH_REDIS = { ...PRODUCTION, REDIS_URL: 'redis://cache.internal:6379' };

    it('refuses an entry that is not a bare origin, with the corrected value', () => {
      for (const [value, fix] of [
        ['https://app.example.test/', 'https://app.example.test'],
        ['https://app.example.test/login', 'https://app.example.test'],
        ['https://App.Example.test', 'https://app.example.test'],
        ['https://app.example.test:443', 'https://app.example.test'],
      ]) {
        const result = boot({ ...WITH_REDIS, CORS_ORIGIN: value });
        expect(result.code, value).toBe(1);
        expect(result.err).toContain(`write it as "${fix}"`);
      }
    });

    it('refuses * and anything that is not an http(s) URL', () => {
      for (const value of ['*', 'app.example.test', 'ftp://app.example.test']) {
        const result = boot({ ...WITH_REDIS, CORS_ORIGIN: value });
        expect(result.code, value).toBe(1);
        expect(result.err).toContain('must be a full origin such as https://app.example.com');
      }
    });

    it('trims entries and ignores empty ones', () => {
      const env = parsed({ ...WITH_REDIS, CORS_ORIGIN: ' https://a.example.test , https://b.example.test ,' });
      expect(env.CORS_ORIGINS).toEqual(['https://a.example.test', 'https://b.example.test']);
    });

    it('still requires at least one origin in production', () => {
      const result = boot({ ...WITH_REDIS, CORS_ORIGIN: ' , ' });
      expect(result.code).toBe(1);
      expect(result.err).toContain('CORS_ORIGIN is required in production');
    });
  });

  describe('CLIENT_URL (email links)', () => {
    const WITH_REDIS = { ...PRODUCTION, REDIS_URL: 'redis://cache.internal:6379' };

    it('refuses to start in production when a Resend key is set but CLIENT_URL is not', () => {
      const result = boot({ ...WITH_REDIS, RESEND_API_KEY: 're_test' });
      expect(result.code).toBe(1);
      expect(result.err).toContain('CLIENT_URL is required in production when RESEND_API_KEY is set');
    });

    it('starts in production with a Resend key and CLIENT_URL', () => {
      const env = parsed({ ...WITH_REDIS, RESEND_API_KEY: 're_test', CLIENT_URL: 'https://app.example.test' });
      expect(env.CLIENT_URL).toBe('https://app.example.test');
    });

    it('needs no CLIENT_URL in production without a Resend key (server-only project)', () => {
      expect(parsed(WITH_REDIS).CLIENT_URL).toBe('http://localhost:3000');
    });
  });

  it('reads on/off switches in any letter case, and defaults them when unset', () => {
    expect(parsed({ ...BASE, NODE_ENV: 'development', RATE_LIMIT_ENABLED: 'TRUE' }).RATE_LIMIT_ENABLED).toBe(true);
    expect(parsed({ ...BASE, NODE_ENV: 'development', RATE_LIMIT_ENABLED: ' False ' }).RATE_LIMIT_ENABLED).toBe(false);
    expect(parsed({ ...BASE, NODE_ENV: 'development' }).RATE_LIMIT_ENABLED).toBe(true);
    // Verification defaults to OFF without the email module (no verify route),
    // and ON once the module is installed (its patcher flips the default; a
    // Resend key is then required).
    const unset = parsed({
      ...REQUIRED,
      NODE_ENV: 'development',
      ...(EMAIL_MODULE_INSTALLED ? { RESEND_API_KEY: 're_test' } : {}),
    });
    expect(unset.REQUIRE_USER_VERIFICATION).toBe(EMAIL_MODULE_INSTALLED);
  });

  it('refuses verification switched on without a Resend key', () => {
    const result = boot({ ...REQUIRED, NODE_ENV: 'development', REQUIRE_USER_VERIFICATION: 'true' });
    expect(result.code).toBe(1);
    expect(result.err).toContain('RESEND_API_KEY is required when REQUIRE_USER_VERIFICATION is enabled');
  });

  it('refuses a switch value that is not true or false instead of reading it as off', () => {
    for (const [name, value] of [
      ['RATE_LIMIT_ENABLED', '1'],
      ['REQUIRE_USER_VERIFICATION', 'yes'],
    ]) {
      const result = boot({ ...BASE, NODE_ENV: 'development', [name]: value });
      expect(result.code, `${name}=${value}`).toBe(1);
      expect(result.err).toContain(`${name}: must be true or false`);
    }
  });
});
