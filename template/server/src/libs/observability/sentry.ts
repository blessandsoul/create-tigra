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
import type { Event } from '@sentry/node';
import { env } from '@config/env.js';
import { logger } from '@libs/logger.js';

let initialized = false;

/**
 * Privacy rule for error tracking: Sentry gets the error, never the secrets
 * around it. Same policy as the log redaction in libs/logger.ts — without it
 * a 500 during login/register/password change would ship the plaintext
 * password, the auth cookies and any token in the URL to a third party.
 *
 * Header names that must never leave the process (compared lowercase).
 */
const SECRET_HEADERS = new Set(['cookie', 'set-cookie', 'authorization', 'proxy-authorization', 'x-api-key']);

/** Drop the query string: reset/verify tokens and other secrets travel there. */
function withoutQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/**
 * Remove request bodies, cookies, auth headers and query strings from an
 * event (errors and transactions) before it is sent. Exported for tests.
 */
export function scrubSentryEvent<T extends Event>(event: T): T {
  const request = event.request;
  if (request) {
    delete request.data;
    delete request.cookies;
    delete request.query_string;
    if (request.url) request.url = withoutQuery(request.url);
    if (request.headers) {
      for (const name of Object.keys(request.headers)) {
        if (SECRET_HEADERS.has(name.toLowerCase())) delete request.headers[name];
      }
    }
  }

  for (const crumb of event.breadcrumbs ?? []) {
    const data = crumb.data as Record<string, unknown> | undefined;
    if (!data) continue;
    if (typeof data.url === 'string') data.url = withoutQuery(data.url);
    delete data['http.query'];
    delete data['url.query'];
  }

  for (const span of event.spans ?? []) {
    const data = span.data as Record<string, unknown> | undefined;
    if (!data) continue;
    for (const key of ['http.url', 'url.full', 'http.target']) {
      if (typeof data[key] === 'string') data[key] = withoutQuery(data[key] as string);
    }
    delete data['http.query'];
    delete data['url.query'];
  }

  return event;
}

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
    // Never attach IPs/user identity automatically.
    sendDefaultPii: false,
    // Don't even buffer incoming request bodies (default 'medium' = 10 KB,
    // which would include login/register/password-change payloads).
    integrations: [Sentry.httpIntegration({ maxIncomingRequestBodySize: 'none' })],
    // Last line of defence for anything another integration still attaches.
    beforeSend: (event) => scrubSentryEvent(event),
    beforeSendTransaction: (event) => scrubSentryEvent(event),
  });

  initialized = true;
  logger.info(`[OBSERVABILITY] Sentry enabled [${env.SENTRY_ENVIRONMENT}]`);
}

export { Sentry };
