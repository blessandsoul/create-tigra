/**
 * Where the integration tests get MySQL and Redis from, and the guards that
 * keep them away from real data. Pure (no I/O), so the rules are unit-tested
 * (src/test/__tests__/integration-services.test.ts); integration.setup.ts
 * applies them.
 *
 * Two modes:
 * - "containers" (neither variable set): Testcontainers starts a throwaway
 *   MySQL and Redis. What CI uses; needs Docker.
 * - "external" (both set): INTEGRATION_DATABASE_URL and INTEGRATION_REDIS_URL
 *   point at services that already run, for machines where starting
 *   containers is not wanted. The tests DROP every table in that database and
 *   FLUSH that Redis database, so both must be visibly disposable: the
 *   database name ends in "_test" and the Redis URL names a database 1-15.
 *
 * Error messages name the rule and never the URL: it carries a password.
 */

export type IntegrationMode =
  | { kind: 'containers' }
  | { kind: 'external'; databaseUrl: string; redisUrl: string };

/** The database name in a mysql:// URL, decoded; '' when there is none or the URL is malformed. */
export function databaseName(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  } catch {
    return '';
  }
}

/** The Redis database number in a redis:// URL path (redis://host:6379/15), or null when missing or not a number. */
export function redisDatabaseIndex(url: string): number | null {
  try {
    const path = new URL(url).pathname.replace(/^\//, '');
    return /^\d+$/.test(path) ? Number(path) : null;
  } catch {
    return null;
  }
}

/**
 * Picks the mode from the environment. One variable without the other is a
 * mistake (half a setup), so it is refused instead of silently falling back to
 * containers.
 */
export function pickIntegrationMode(env: NodeJS.ProcessEnv): IntegrationMode {
  const databaseUrl = env.INTEGRATION_DATABASE_URL?.trim() || undefined;
  const redisUrl = env.INTEGRATION_REDIS_URL?.trim() || undefined;
  if (!databaseUrl && !redisUrl) return { kind: 'containers' };
  if (!databaseUrl || !redisUrl) {
    throw new Error(
      'Set both INTEGRATION_DATABASE_URL and INTEGRATION_REDIS_URL to use existing services, or neither to use Testcontainers.',
    );
  }
  assertDisposable(databaseUrl, redisUrl);
  return { kind: 'external', databaseUrl, redisUrl };
}

/** Refuses services that could hold real data, before anything connects to them. */
export function assertDisposable(databaseUrl: string, redisUrl: string): void {
  if (!databaseName(databaseUrl).endsWith('_test')) {
    throw new Error(
      'INTEGRATION_DATABASE_URL must name a database ending in "_test": the integration tests drop every table in it.',
    );
  }
  const index = redisDatabaseIndex(redisUrl);
  if (index === null || index < 1 || index > 15) {
    throw new Error(
      'INTEGRATION_REDIS_URL must end with a Redis database number from 1 to 15 (for example redis://localhost:6379/15): ' +
        'the integration tests flush that database, and database 0 (the default) is refused.',
    );
  }
}
