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

const envSchema = z.object({
  // --- Application ---
  NODE_ENV: optionalEnv(z.enum(['development', 'production', 'test']).default('development')),
  PORT: optionalEnv(z.coerce.number().int().min(1).max(65535).default(8000)),
  HOST: optionalEnv(z.string().default('0.0.0.0')),

  // --- Server timeouts ---
  // Fastify request/connection timeouts. Defaults match the previous hardcoded
  // values. Long-running routes (LLM calls, large exports) may need 180s+ —
  // remember the reverse proxy (Nginx/Coolify) timeout must be raised to match,
  // or the proxy will cut the connection before the server does.
  REQUEST_TIMEOUT_MS: optionalEnv(z.coerce.number().int().min(1).default(30000)),
  CONNECTION_TIMEOUT_MS: optionalEnv(z.coerce.number().int().min(1).default(60000)),

  // --- Database (MySQL 8.0+) ---
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_POOL_MIN: optionalEnv(z.coerce.number().int().min(1).default(2)),
  DATABASE_POOL_MAX: optionalEnv(z.coerce.number().int().min(1).max(1000).default(10)),

  // --- Redis ---
  REDIS_URL: optionalEnv(z.string().default('redis://localhost:6379')),
  REDIS_MAX_RETRIES: optionalEnv(z.coerce.number().int().min(0).default(3)),
  REDIS_CONNECT_TIMEOUT: optionalEnv(z.coerce.number().int().min(1000).default(10000)), // ms

  // --- Rate Limiting ---
  RATE_LIMIT_ENABLED: optionalEnv(z.string().default('true').transform((val) => val === 'true')),
  RATE_LIMIT_MULTIPLIER: optionalEnv(z.coerce.number().min(0.1).max(100).default(1)),

  // When true, derive the client IP for rate-limiting / IP-blocking from the
  // Cloudflare `CF-Connecting-IP` header instead of the socket/X-Forwarded-For
  // IP (which is a Cloudflare edge IP behind the proxy — see src/libs/client-ip.ts).
  // Default false: the header is client-spoofable, so enable this ONLY when the
  // origin accepts traffic exclusively via Cloudflare.
  TRUST_CLOUDFLARE: optionalEnv(z.string().default('false').transform((val) => val === 'true')),
  RATE_LIMIT_AUTH_LOGIN_MAX: optionalEnv(z.coerce.number().int().min(1).optional()),
  RATE_LIMIT_AUTH_REGISTER_MAX: optionalEnv(z.coerce.number().int().min(1).optional()),

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

  // --- JWT Authentication ---
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters')
    // The committed .env.example placeholder is 43 chars and would pass min(32) —
    // every scaffolded app would boot with the same publicly-known signing key.
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
  // Leave empty for same-origin deployments or local development
  COOKIE_DOMAIN: optionalEnv(z.string().optional()),

  // --- Account Activation ---
  // When true (default), new users are created as inactive and must verify
  // their account before they can log in. When false, users are active immediately.
  REQUIRE_USER_VERIFICATION: optionalEnv(z.string().default('true').transform((val) => val === 'true')),

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
  CLIENT_URL: optionalEnv(z.string().url().default('http://localhost:3000')),

  // --- Error Tracking (Optional) ---
  SENTRY_DSN: optionalEnv(z.string().url().optional()),
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

// Validate RESEND_API_KEY when email verification is enabled
if (parsed.data.REQUIRE_USER_VERIFICATION && !parsed.data.RESEND_API_KEY) {
  console.error('\nRESEND_API_KEY is required when REQUIRE_USER_VERIFICATION is enabled.\nGet your API key from: https://resend.com/api-keys\n');
  process.exit(1);
}

export const env = parsed.data;

export type Env = z.infer<typeof envSchema>;
