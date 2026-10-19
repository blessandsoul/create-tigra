/**
 * Integration tests, once per run: get MySQL and Redis ready and hand their
 * addresses to every test file (vitest.integration.config.ts → globalSetup).
 * Runs in Vitest's main process before any test file; each file then reads
 * the addresses with `inject('integration')` (src/test/integration.setup.ts).
 *
 * ── Where MySQL and Redis come from (rules in ./integration-services.ts) ───
 * - Neither INTEGRATION_DATABASE_URL nor INTEGRATION_REDIS_URL set:
 *   Testcontainers starts a throwaway MySQL 8.4 and Redis 7. This is what CI
 *   does; it needs Docker.
 * - Both set: those already-running services are used and no container is
 *   started. Every table in that database is dropped and that Redis database
 *   is flushed first, so the database name must end in "_test" and the Redis
 *   URL must name a database 1-15; anything else stops the run before it
 *   connects.
 *
 * ── The schema comes from the shipped migrations ───────────────────────────
 * `prisma migrate deploy` applies prisma/migrations, exactly what the
 * production container runs at start, so a migration that does not match the
 * code fails here. (It used to be `prisma db push`, which tested the schema
 * file but never the migrations a project actually ships.) The tables are
 * dropped by emptyDatabase below, not by `prisma migrate reset`: Prisma
 * refuses that command when an AI agent runs it, and agents run these tests.
 *
 * All test files share this one database and Redis, so each test creates its
 * own uniquely named data, and the files run one after another.
 */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { Redis } from 'ioredis';
import type { TestProject } from 'vitest/node';
import { pickIntegrationMode } from './integration-services.js';

/** What every integration test file receives (see integration.setup.ts). */
export interface IntegrationContext {
  mode: 'containers' | 'external';
  databaseUrl: string;
  redisUrl: string;
  uploadPublicDir: string;
  uploadPrivateDir: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    integration: IntegrationContext;
  }
}

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Starts a throwaway MySQL and Redis. Imported lazily so the external mode never loads Docker code. */
async function startContainers(): Promise<{ databaseUrl: string; redisUrl: string; stop: () => Promise<void> }> {
  const [{ MySqlContainer }, { RedisContainer }] = await Promise.all([
    import('@testcontainers/mysql'),
    import('@testcontainers/redis'),
  ]);
  const mysql = await new MySqlContainer('mysql:8.4')
    .withDatabase('test_db')
    .withUsername('test')
    .withUserPassword('test')
    .withRootPassword('rootpass')
    .start();
  const redis = await new RedisContainer('redis:7-alpine').start();
  return {
    // MySqlContainer.getConnectionUri() returns `mysql://user:pass@host:port/db`
    // — exactly Prisma's DATABASE_URL shape.
    databaseUrl: mysql.getConnectionUri(),
    redisUrl: redis.getConnectionUrl(),
    stop: async (): Promise<void> => {
      await Promise.allSettled([redis.stop(), mysql.stop()]);
    },
  };
}

/**
 * Drops every table in the guarded database, `_prisma_migrations` included,
 * so migrate deploy starts from nothing. The interactive transaction pins one
 * connection, which the session-level FOREIGN_KEY_CHECKS switch needs.
 */
async function emptyDatabase(databaseUrl: string): Promise<void> {
  const { PrismaClient } = await import('@prisma/client');
  const client = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    await client.$transaction(async (tx) => {
      const tables = await tx.$queryRaw<{ name: string }[]>`
        SELECT TABLE_NAME AS name FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`;
      if (tables.length === 0) return;
      const list = tables.map(({ name }) => `\`${name.replace(/`/g, '``')}\``).join(', ');
      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
      await tx.$executeRawUnsafe(`DROP TABLE ${list}`);
      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
    });
  } finally {
    await client.$disconnect();
  }
}

/** Empties the guarded Redis database. */
async function flushRedis(redisUrl: string): Promise<void> {
  const redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    await redis.flushdb();
  } finally {
    redis.disconnect();
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  // Throws (with the rule, never the URL) on half a setup or services that do
  // not look disposable, before anything connects.
  const mode = pickIntegrationMode(process.env);
  const services =
    mode.kind === 'external'
      ? { databaseUrl: mode.databaseUrl, redisUrl: mode.redisUrl, stop: async (): Promise<void> => {} }
      : await startContainers();

  if (mode.kind === 'external') {
    await emptyDatabase(services.databaseUrl);
    await flushRedis(services.redisUrl);
  }
  // Prisma prints the host and database name, never the password.
  execSync('npx prisma migrate deploy', {
    cwd: serverRoot,
    env: { ...process.env, DATABASE_URL: services.databaseUrl },
    stdio: 'inherit',
  });

  const uploadsRoot = path.join(os.tmpdir(), `create-tigra-uploads-${process.pid}`);
  project.provide('integration', {
    mode: mode.kind,
    databaseUrl: services.databaseUrl,
    redisUrl: services.redisUrl,
    uploadPublicDir: path.join(uploadsRoot, 'public'),
    uploadPrivateDir: path.join(uploadsRoot, 'private'),
  });

  // Teardown: stop the containers this run started; existing services keep
  // the test data until the next run empties them.
  return services.stop;
}
