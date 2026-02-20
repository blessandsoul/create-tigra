import { z } from 'zod';
import dotenv from 'dotenv';

// Suppress dotenv's informational logs
process.env.DOTENV_CONFIG_QUIET = 'true';
dotenv.config();

const envSchema = z.object({
  // --- Application ---
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8000),
  HOST: z.string().default('0.0.0.0'),

  // --- Database (MySQL 8.0+) ---
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_POOL_MIN: z.coerce.number().int().min(1).default(2),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(1000).default(10),

  // --- Redis ---
  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_MAX_RETRIES: z.coerce.number().int().min(0).default(3),
  REDIS_CONNECT_TIMEOUT: z.coerce.number().int().min(1000).default(10000), // ms

  // --- JWT Authentication ---
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),

  // --- Cookie ---
  // Separate secret for cookie signing (defaults to JWT_SECRET if not set)
  COOKIE_SECRET: z.string().min(32, 'COOKIE_SECRET must be at least 32 characters').optional(),

  // --- CORS ---
  // In development: CORS_ORIGIN is optional (allows all origins)
  // In production: REQUIRED for security
  // Supports comma-separated multiple origins: "https://a.com,https://b.com"
  CORS_ORIGIN: z.string().optional(),

  // --- Logging ---
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // --- Error Tracking (Optional) ---
  SENTRY_DSN: z.string().url().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const formatted = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');

  // eslint-disable-next-line no-console
  console.error(`\nEnvironment validation failed:\n${formatted}\n`);
  process.exit(1);
}

// Validate CORS_ORIGIN in production
if (parsed.data.NODE_ENV === 'production' && !parsed.data.CORS_ORIGIN) {
  // eslint-disable-next-line no-console
  console.error('\nCORS_ORIGIN is required in production for security\n');
  process.exit(1);
}

export const env = parsed.data;

export type Env = z.infer<typeof envSchema>;
