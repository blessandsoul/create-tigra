/**
 * Server/Edge runtime instrumentation — env-gated Sentry, INERT by default.
 *
 * Next.js calls `register()` once per server runtime at startup. We init Sentry
 * ONLY when a DSN is present (a server `SENTRY_DSN`, or the public DSN shared
 * with the browser), so with no DSN this is a clean no-op and `next build`
 * succeeds with zero Sentry credentials.
 *
 * NOTE: we deliberately do NOT wrap next.config.ts with `withSentryConfig`.
 * That adds build-time source-map upload which requires a SENTRY_AUTH_TOKEN and
 * would couple `next build` to credentials. Source-map upload is the opt-in
 * upgrade — add `withSentryConfig` + an auth token when you want it. This setup
 * stays purely runtime + env-gated.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN;

const tracesSampleRate = process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE
  ? Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE)
  : 0.1;

export async function register(): Promise<void> {
  // No DSN → stay inert.
  if (!dsn) return;

  if (process.env.NEXT_RUNTIME === 'nodejs' || process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init({
      dsn,
      tracesSampleRate,
      environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    });
  }
}

// Capture errors from Server Components, route handlers, and middleware.
// Safe no-op when Sentry was never initialized (no DSN).
export const onRequestError = Sentry.captureRequestError;
