/**
 * Browser (client) instrumentation — env-gated Sentry, INERT by default.
 *
 * Next.js 15.3+/16 loads this module in the browser before the app hydrates.
 * We init Sentry ONLY when the public DSN is set, so with no DSN this file is a
 * no-op and ships nothing that phones home.
 *
 * `process.env.NEXT_PUBLIC_*` is inlined at build time by Next — reference it
 * literally (not via a computed key) so the value is statically replaced.
 *
 * Like the server side, this stays runtime + env-gated: we do NOT wrap
 * next.config.ts with `withSentryConfig` (that would couple `next build` to a
 * source-map upload auth token). withSentryConfig is the opt-in upgrade.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE
      ? Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE)
      : 0.1,
  });
}

// Instruments App Router navigations for tracing. Harmless when Sentry is
// uninitialized (no DSN).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
