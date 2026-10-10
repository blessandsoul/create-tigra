/**
 * Privacy filter for Sentry events sent from the Next.js app (browser and the
 * Node/Edge server runtime). Mirrors the API server's scrubber
 * (server/src/libs/observability/sentry.ts).
 *
 * Why it exists: Next's `captureRequestError` attaches the incoming request's
 * headers (including the Cookie header), and browser events/breadcrumbs carry
 * page URLs such as /reset-password?token=… and /verify-account?token=…. Those
 * values are credentials and must never reach a third-party error tracker.
 *
 * Kept dependency-free (type-only import) so it never pulls @sentry/nextjs into
 * a bundle by itself.
 */
import type { Event } from '@sentry/nextjs';

const SECRET_HEADERS = new Set(['cookie', 'set-cookie', 'authorization', 'proxy-authorization', 'x-api-key']);

/** Drop the query string and fragment: tokens travel there. */
function withoutQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
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
        if (SECRET_HEADERS.has(name.toLowerCase())) delete request.headers[name];
      }
    }
  }

  for (const crumb of event.breadcrumbs ?? []) {
    const data = crumb.data as Record<string, unknown> | undefined;
    if (!data) continue;
    for (const key of ['url', 'from', 'to']) {
      if (typeof data[key] === 'string') data[key] = withoutQuery(data[key] as string);
    }
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
