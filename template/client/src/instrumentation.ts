/**
 * Server/Edge runtime instrumentation.
 *
 * Keep local dev cold: importing @sentry/nextjs at module top-level makes Next
 * compile the Sentry SDK before the first page, even with no DSN.
 */
type SentryNext = typeof import('@sentry/nextjs');
type RequestErrorHandler = SentryNext['captureRequestError'];

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN;
const sentryEnabled = process.env.NODE_ENV === 'production' && Boolean(dsn);

const tracesSampleRate = process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE
  ? Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE)
  : 0.1;

let sentryPromise: Promise<SentryNext> | null = null;

function loadSentry(): Promise<SentryNext | null> {
  if (!sentryEnabled) return Promise.resolve(null);
  sentryPromise ??= import('@sentry/nextjs');
  return sentryPromise;
}

export async function register(): Promise<void> {
  const Sentry = await loadSentry();
  if (!Sentry || !dsn) return;

  if (process.env.NEXT_RUNTIME === 'nodejs' || process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init({
      dsn,
      tracesSampleRate,
      environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    });
  }
}

export const onRequestError = (async (...args: Parameters<RequestErrorHandler>) => {
  const Sentry = await loadSentry();
  if (!Sentry) return;
  return Sentry.captureRequestError(...args);
}) as RequestErrorHandler;
