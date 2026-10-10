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
 * Header names that must never leave the process (compared lowercase), and
 * headers whose value is a URL that may carry a token in its query string.
 * Keep in step with the client scrubber (client/src/lib/observability/sentry-scrub.ts).
 */
const SECRET_HEADERS = new Set(['cookie', 'set-cookie', 'authorization', 'proxy-authorization', 'x-api-key']);
const URL_HEADERS = new Set(['referer', 'referrer']);

/** Drop the query string: reset/verify tokens and other secrets travel there. */
function withoutQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/**
 * Clean a free-form attribute bag (breadcrumb data, span data, trace data):
 * strip queries from anything URL-like (url.full, http.target, referer
 * attributes, …) and drop query/cookie/auth attributes entirely.
 */
function scrubData(data: Record<string, unknown> | undefined): void {
  if (!data) return;
  for (const key of Object.keys(data)) {
    const lower = key.toLowerCase();
    if (lower.includes('query') || lower.includes('cookie') || lower.includes('authorization')) {
      delete data[key];
      continue;
    }
    const value = data[key];
    if (
      typeof value === 'string' &&
      (lower.includes('url') || lower.includes('referer') || lower.includes('target') || lower === 'from' || lower === 'to')
    ) {
      data[key] = withoutQuery(value);
    }
  }
}

/**
 * Remove request bodies, cookies, auth headers and query strings (including
 * inside the Referer header, span/trace attributes and the transaction name)
 * from an event before it is sent. Exported for tests.
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
        const lower = name.toLowerCase();
        if (SECRET_HEADERS.has(lower)) delete request.headers[name];
        else if (URL_HEADERS.has(lower)) request.headers[name] = withoutQuery(request.headers[name]);
      }
    }
  }

  if (event.transaction) event.transaction = withoutQuery(event.transaction);
  for (const crumb of event.breadcrumbs ?? []) scrubData(crumb.data as Record<string, unknown> | undefined);
  for (const span of event.spans ?? []) scrubData(span.data as Record<string, unknown> | undefined);
  scrubData(event.contexts?.trace?.data as Record<string, unknown> | undefined);

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
