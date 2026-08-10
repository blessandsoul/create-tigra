/**
 * Browser instrumentation.
 *
 * Keep local dev cold: do not import @sentry/nextjs unless production has a
 * public DSN. This avoids compiling the Sentry SDK for every local dev server.
 */
type SentryNext = typeof import('@sentry/nextjs');
type RouterTransitionStart = SentryNext['captureRouterTransitionStart'];

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const sentryEnabled = process.env.NODE_ENV === 'production' && Boolean(dsn);

let sentryPromise: Promise<SentryNext> | null = null;

function loadSentry(): Promise<SentryNext | null> {
  if (!sentryEnabled || !dsn) return Promise.resolve(null);

  sentryPromise ??= import('@sentry/nextjs').then((Sentry) => {
    Sentry.init({
      dsn,
      tracesSampleRate: process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE
        ? Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE)
        : 0.1,
    });

    return Sentry;
  });

  return sentryPromise;
}

void loadSentry();

export const onRouterTransitionStart = ((...args: Parameters<RouterTransitionStart>) => {
  void loadSentry().then((Sentry) => {
    Sentry?.captureRouterTransitionStart(...args);
  });
}) as RouterTransitionStart;
