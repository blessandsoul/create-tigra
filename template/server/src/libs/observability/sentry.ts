/**
 * Sentry (error tracking) — env-gated, INERT by default.
 *
 * With no `SENTRY_DSN` set, `initSentry()` short-circuits and the SDK is never
 * initialized. `Sentry.captureException(...)` elsewhere is a safe no-op when the
 * SDK is uninitialized, so the rest of the app needs no DSN-presence guards.
 *
 * Never hardcode a DSN here or anywhere — it comes only from the environment.
 */
import * as Sentry from '@sentry/node';
import { env } from '@config/env.js';
import { logger } from '@libs/logger.js';

let initialized = false;

/**
 * Initialize Sentry only when a DSN is configured.
 *
 * Call this as early as possible in the process lifecycle (top of server.ts),
 * BEFORE the app is built, so error capture is active before any request is
 * handled. A missing DSN is a clean no-op (no throw).
 */
export function initSentry(): void {
  if (initialized) return;

  if (!env.SENTRY_DSN) {
    // No DSN → stay inert. One quiet debug line; nothing in prod logs at info.
    logger.debug('[OBSERVABILITY] Sentry disabled (no DSN)');
    return;
  }

  Sentry.init({
    dsn: env.SENTRY_DSN,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    environment: env.SENTRY_ENVIRONMENT,
  });

  initialized = true;
  logger.info(`[OBSERVABILITY] Sentry enabled [${env.SENTRY_ENVIRONMENT}]`);
}

export { Sentry };
