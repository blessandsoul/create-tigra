import { z } from 'zod';
import dotenv from 'dotenv';

// Suppress dotenv's informational logs
process.env.DOTENV_CONFIG_QUIET = 'true';
dotenv.config();

/**
 * Treat present-but-empty env vars as unset.
 *
 * The .env ↔ .env.example sync convention produces `VAR=""` placeholders, and
 * Zod's `.optional()` rejects a present-but-empty string (e.g. `.url()` or
 * `.min(32)` fails on "") — which killed boot in incident aeaaf94a. Mapping
 * "" → undefined makes empty placeholders behave like missing vars: optionals
 * stay undefined, defaults kick in. Production presence guards (`!env.VAR`)
 * keep working since "" parses to undefined.
 */
const optionalEnv = <T extends z.ZodTypeAny>(schema: T): z.ZodPreprocess<T> =>
  z.preprocess((v) => (v === '' ? undefined : v), schema);

/**
 * An on/off switch. Accepts `true` / `false` in any letter case (spaces around
 * ignored) and stops the boot on anything else. A plain `val === 'true'` used
 * to read `True`, `TRUE` or `1` as OFF without a word, which silently switched
 * rate limits or email verification off. Empty or unset means `defaultValue`.
 */
const envBoolean = (defaultValue: boolean): z.ZodType<boolean> =>
  z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim().toLowerCase() : undefined),
      z.enum(['true', 'false'], { message: 'must be true or false' }).default(defaultValue ? 'true' : 'false'),
    )
    .transform((v) => v === 'true');

const envSchema = z.object({
  // --- Application ---
  // Fail-closed default: an unset NODE_ENV means production. Development mode
  // deliberately relaxes CORS, the Origin check and Secure cookies, so a
  // deployment that forgets NODE_ENV must not silently land there. Local dev
  // gets NODE_ENV=development from the generated .env; tests set 'test'.
  NODE_ENV: optionalEnv(z.enum(['development', 'production', 'test']).default('production')),
  PORT: optionalEnv(z.coerce.number().int().min(1).max(65535).default(8000)),
  HOST: optionalEnv(z.string().default('0.0.0.0')),

  // --- Server timeouts ---
  // Fastify request/connection timeouts. Defaults match the previous hardcoded
  // values. Long-running routes (LLM calls, large exports) may need 180s+ —
  // remember the reverse proxy (Nginx/Coolify) timeout must be raised to match,
  // or the proxy will cut the connection before the server does.
  REQUEST_TIMEOUT_MS: optionalEnv(z.coerce.number().int().min(1).default(30000)),
  CONNECTION_TIMEOUT_MS: optionalEnv(z.coerce.number().int().min(1).default(60000)),

  // --- Database (MySQL 8.4 LTS; 8.0+ works) ---
  // The connection pool is sized INSIDE this URL (`?connection_limit=20&pool_timeout=10`); Prisma
  // reads no separate pool variables. Without connection_limit Prisma uses CPU cores x 2 + 1.
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // --- Redis ---
  // Required in production (checked below); elsewhere it defaults to the local
  // redis://localhost:6379. See the production check for why.
  REDIS_URL: optionalEnv(z.string().optional()),
  // Retries for a single Redis command. The connection itself reconnects
  // forever with capped backoff (see src/libs/redis.ts).
  REDIS_MAX_RETRIES: optionalEnv(z.coerce.number().int().min(0).default(3)),
  REDIS_CONNECT_TIMEOUT: optionalEnv(z.coerce.number().int().min(1000).default(10000)), // ms

  // --- Rate Limiting ---
  RATE_LIMIT_ENABLED: envBoolean(true),
  RATE_LIMIT_MULTIPLIER: optionalEnv(z.coerce.number().min(0.1).max(100).default(1)),
  // Per-limit overrides, e.g. "AUTH_LOGIN=100/15m,DEFAULT=300/1m,EMAIL_PER_ADDRESS=3/1h".
  // Parsed and validated (names and format) in src/config/rate-limit.config.ts, which stops
  // the server at boot on a mistake. The multiplier still applies on top of an override.
  RATE_LIMIT_OVERRIDES: optionalEnv(z.string().optional()),

  // There is no Cloudflare switch: the visitor address is verified per request (Cloudflare is
  // recognised by its published edge ranges), see src/libs/client-ip.ts. A TRUST_CLOUDFLARE
  // value left over on an older deployment is simply ignored (this object is not strict).
  //
  // Optional, recommended behind Cloudflare: a secret that a Cloudflare Transform Rule on YOUR
  // zone adds to every request as the `X-Origin-Verify` header. When set, Cloudflare's visitor
  // header is believed only on requests carrying it, which proves they came through your own
  // zone and not through someone else's Cloudflare Worker. Generate: openssl rand -hex 32
  CLOUDFLARE_ORIGIN_SECRET: optionalEnv(
    z
      .string()
      .min(32, 'CLOUDFLARE_ORIGIN_SECRET must be at least 32 characters')
      .refine((s) => !s.startsWith('CHANGE_ME'), 'CLOUDFLARE_ORIGIN_SECRET is still the placeholder')
      .optional(),
  ),

  // --- IP Auto-Block (see src/libs/ip-block.ts) ---
  // An IP that exceeds rate limits IP_AUTO_BLOCK_THRESHOLD times within
  // IP_AUTO_BLOCK_WINDOW_SECONDS is blocked for IP_AUTO_BLOCK_DURATION_SECONDS.
  // The threshold targets sustained abuse, not a single burst — a retry-looping
  // but legitimate client (or a NAT'd office sharing one IP) must not self-ban.
  IP_AUTO_BLOCK_THRESHOLD: optionalEnv(z.coerce.number().int().min(1).default(20)),
  IP_AUTO_BLOCK_WINDOW_SECONDS: optionalEnv(z.coerce.number().int().min(1).default(300)),
  IP_AUTO_BLOCK_DURATION_SECONDS: optionalEnv(z.coerce.number().int().min(1).default(3600)),

  // --- File Upload ---
  MAX_FILE_SIZE_MB: optionalEnv(z.coerce.number().min(1).max(100).default(10)),

  // --- Two-tier upload storage (see src/libs/storage/file-storage.service.ts) ---
  // PUBLIC tier: served as static files at /uploads/ — viewable by ANYONE,
  //   including unauthenticated users (e.g. social-style avatars). @fastify/static
  //   is scoped to ONLY this directory so it can never serve a private file.
  // PRIVATE tier: lives OUTSIDE the static root and is served ONLY through the
  //   auth-gated streaming route GET /api/v1/files/:filename (owner-scoped).
  // Both optional with sensible <cwd>/uploads/{public,private} defaults so a
  // clean env still boots; the storage service resolves the defaults at runtime.
  UPLOAD_PUBLIC_DIR: optionalEnv(z.string().optional()),
  UPLOAD_PRIVATE_DIR: optionalEnv(z.string().optional()),

  // --- JWT Authentication ---
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters')
    // Every secret committed in the template's .env.example files is example
    // text starting with CHANGE_ME (43 chars, so it would pass min(32)). This
    // guard is what stops an app from booting with that publicly-known signing
    // key. Keep any new example secret on the CHANGE_ME prefix; CI asserts it.
    .refine(
      (s) => !s.startsWith('CHANGE_ME'),
      'JWT_SECRET is still the placeholder — generate one: openssl rand -hex 48',
    ),
  JWT_ACCESS_EXPIRY: optionalEnv(z.string().default('15m')),
  JWT_REFRESH_EXPIRY: optionalEnv(z.string().default('7d')),

  // --- Cookie ---
  // Separate secret for cookie signing (defaults to JWT_SECRET if not set)
  COOKIE_SECRET: optionalEnv(
    z
      .string()
      .min(32, 'COOKIE_SECRET must be at least 32 characters')
      .refine(
        (s) => !s.startsWith('CHANGE_ME'),
        'COOKIE_SECRET is still the placeholder — generate one: openssl rand -hex 48',
      )
      .optional(),
  ),

  // Cookie domain for cross-origin deployments (client ≠ server hostname)
  // Required when client and API are on different subdomains (e.g., app.example.com + api.example.com)
  // Set to the shared parent domain with a leading dot: ".example.com"
  // Leave empty for same-origin deployments or local development.
  // Applies only to the non-secret auth_session cookie; the token cookies are
  // always host-only on the API (see src/libs/cookies.ts).
  COOKIE_DOMAIN: optionalEnv(z.string().optional()),

  // --- Account Activation ---
  // When true (default), new users start with emailVerifiedAt = null and cannot
  // sign in until they verify their email. When false, they count as verified
  // immediately. This never touches isActive, which is only the admin ban switch.
  REQUIRE_USER_VERIFICATION: envBoolean(true),

  // --- CORS ---
  // In development: CORS_ORIGIN is optional (allows all origins)
  // In production: REQUIRED for security
  // Supports comma-separated multiple origins: "https://a.com,https://b.com"
  CORS_ORIGIN: optionalEnv(z.string().optional()),

  // --- Logging ---
  LOG_LEVEL: optionalEnv(z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info')),

  // --- Email (Resend) ---
  RESEND_API_KEY: optionalEnv(z.string().min(1).optional()),
  RESEND_FROM_EMAIL: optionalEnv(z.string().email().default('onboarding@resend.dev')),
  // The client's address, used ONLY to build links inside emails (password
  // reset, verification). Required in production when RESEND_API_KEY is set
  // (checked below); otherwise it defaults to http://localhost:3000, so a
  // server-only project without email needs no client address at all.
  CLIENT_URL: optionalEnv(z.string().url().optional()),

  // --- Error Tracking (Optional, Sentry) ---
  // All inert without SENTRY_DSN — Sentry init becomes a no-op (see
  // src/libs/observability/sentry.ts). Never hardcode a DSN.
  SENTRY_DSN: optionalEnv(z.string().url().optional()),
  // Fraction of transactions sampled for performance tracing (0..1).
  SENTRY_TRACES_SAMPLE_RATE: optionalEnv(z.coerce.number().min(0).max(1).default(0.1)),
  // Environment tag attached to Sentry events; defaults to NODE_ENV when unset.
  SENTRY_ENVIRONMENT: optionalEnv(z.string().optional()),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const formatted = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');

  console.error(`\nEnvironment validation failed:\n${formatted}\n`);
  process.exit(1);
}

// Validate CORS_ORIGIN in production
if (parsed.data.NODE_ENV === 'production' && !parsed.data.CORS_ORIGIN) {
  console.error('\nCORS_ORIGIN is required in production for security\n');
  process.exit(1);
}

// Require REDIS_URL in production. Redis-backed protections fail OPEN by design
// (a Redis outage must not take the API down), so a missing URL would not
// crash anything: inside a container the localhost default reaches nothing,
// and the app would run with rate limits, login lockout and IP blocks all off
// while its health check still passes. A missing setting must be loud instead.
if (parsed.data.NODE_ENV === 'production' && !parsed.data.REDIS_URL) {
  console.error(
    '\nREDIS_URL is required in production: without Redis, rate limits, login lockout and IP blocks are all off\n',
  );
  process.exit(1);
}

// Require CLIENT_URL in production when emails can go out: without it every
// reset or verification link would point at http://localhost:3000. A
// production server without a Resend key sends no email, so it needs none.
if (parsed.data.NODE_ENV === 'production' && parsed.data.RESEND_API_KEY && !parsed.data.CLIENT_URL) {
  console.error(
    '\nCLIENT_URL is required in production when RESEND_API_KEY is set: email links would point to http://localhost:3000\n',
  );
  process.exit(1);
}

// Validate RESEND_API_KEY when email verification is enabled
if (parsed.data.REQUIRE_USER_VERIFICATION && !parsed.data.RESEND_API_KEY) {
  console.error('\nRESEND_API_KEY is required when REQUIRE_USER_VERIFICATION is enabled.\nGet your API key from: https://resend.com/api-keys\n');
  process.exit(1);
}

export const env = {
  ...parsed.data,
  // Outside production a missing REDIS_URL means the local default (checked above).
  REDIS_URL: parsed.data.REDIS_URL ?? 'redis://localhost:6379',
  // A missing CLIENT_URL means the local client (production with email is checked above).
  CLIENT_URL: parsed.data.CLIENT_URL ?? 'http://localhost:3000',
  // Default the Sentry environment tag to NODE_ENV when not explicitly set.
  SENTRY_ENVIRONMENT: parsed.data.SENTRY_ENVIRONMENT ?? parsed.data.NODE_ENV,
};

export type Env = z.infer<typeof envSchema>;
