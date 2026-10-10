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

  sentryPromise ??= Promise.all([
    import('@sentry/nextjs'),
    import('./lib/observability/sentry-scrub'),
  ]).then(([Sentry, { scrubSentryEvent }]) => {
    Sentry.init({
      dsn,
      tracesSampleRate: process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE
        ? Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE)
        : 0.1,
      sendDefaultPii: false,
      // Page URLs like /reset-password?token=… and /verify-account?token=…
      // carry credentials: strip query strings and cookies from every event.
      beforeSend: (event) => scrubSentryEvent(event),
      beforeSendTransaction: (event) => scrubSentryEvent(event),
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
