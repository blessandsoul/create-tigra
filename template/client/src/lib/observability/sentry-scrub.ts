/**
 * Privacy filter for Sentry events sent from the Next.js app (browser and the
 * Node/Edge server runtime). Mirrors the API server's scrubber
 * (server/src/libs/observability/sentry.ts) — keep the two in step.
 *
 * Why it exists: Next's `captureRequestError` attaches the incoming request's
 * headers (including the Cookie header), and the browser SDK attaches the page
 * URL and the Referer, both as request headers and as span/trace attributes.
 * Page URLs such as /reset-password?token=… and /verify-account?token=… carry
 * credentials, so every URL-like value loses its query string and fragment,
 * and cookie/auth headers are dropped, before anything is sent.
 *
 * Kept dependency-free (type-only import) so it never pulls @sentry/nextjs into
 * a bundle by itself.
 */
import type { Event } from '@sentry/nextjs';

const SECRET_HEADERS = new Set(['cookie', 'set-cookie', 'authorization', 'proxy-authorization', 'x-api-key']);
const URL_HEADERS = new Set(['referer', 'referrer']);

/** Drop the query string and fragment: tokens travel there. */
function withoutQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/**
 * Clean a free-form attribute bag (breadcrumb data, span data, trace data):
 * strip queries from anything URL-like, drop query/cookie/auth attributes.
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
