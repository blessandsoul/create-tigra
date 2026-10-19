/**
 * Which database client the app gets (../prisma.ts): production the plain
 * PrismaClient, untouched; every other environment the client with the
 * query-counting extension behind the dev X-Query-Count header. An extended
 * client has no `$on`, which tells the two apart without a database.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

async function clientFor(nodeEnv: 'production' | 'development' | 'test'): Promise<Record<string, unknown>> {
  vi.resetModules();
  vi.doMock('@config/env.js', () => ({ env: { NODE_ENV: nodeEnv, LOG_LEVEL: 'silent' } }));
  const { prisma } = await import('../prisma.js');
  return prisma as unknown as Record<string, unknown>;
}

afterEach(() => {
  vi.doUnmock('@config/env.js');
});

describe('prisma client per environment', () => {
  it('production: the plain client, no extension', async () => {
    expect(typeof (await clientFor('production')).$on).toBe('function');
  });

  it.each(['development', 'test'] as const)('%s: the query-counting extension', async (nodeEnv) => {
    expect((await clientFor(nodeEnv)).$on).toBeUndefined();
  });
});
