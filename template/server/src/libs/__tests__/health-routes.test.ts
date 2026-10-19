/**
 * The public probes (../health-routes.ts): /health answers only { status }
 * (no checks, timings, memory, version) with 200/200/503, and /ready and /live
 * keep their shapes. The checks themselves are mocked; monitoring.test.ts
 * covers them.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { performHealthCheck, checkReadiness } from '@libs/monitoring.js';
import { registerHealthRoutes } from '../health-routes.js';

vi.mock('@libs/monitoring.js', () => ({
  performHealthCheck: vi.fn(),
  checkReadiness: vi.fn(),
  checkLiveness: vi.fn(() => true),
}));

/** A full report, as the admin route would show it: none of this may reach the public body. */
function report(status: 'healthy' | 'degraded' | 'unhealthy'): Awaited<ReturnType<typeof performHealthCheck>> {
  return {
    status,
    checks: {
      database: { status: 'up', responseTime: 3 },
      redis: { status: status === 'degraded' ? 'down' : 'up', message: 'Redis connection failed (non-fatal)', details: { maxRetries: 3 } },
      memory: { status: 'up', details: { heapUsedMB: 50, heapLimitMB: 4096 } },
      uptime: { status: 'up', details: { uptimeSeconds: 99 } },
    },
    timestamp: '2026-10-20T00:00:00.000Z',
    checkedAt: '2026-10-20T00:00:00.000Z',
    version: '1.2.3',
    commit: 'abc1234def56',
    environment: 'production',
  };
}

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  registerHealthRoutes(app);
  await app.ready();
});
afterAll(() => app.close());
beforeEach(() => vi.clearAllMocks());

describe('GET /api/v1/health (public)', () => {
  it.each([
    ['healthy', 200, 'All systems operational'],
    ['degraded', 200, 'Some systems degraded'],
    ['unhealthy', 503, 'System unhealthy'],
  ] as const)('%s → %i with only the status', async (status, code, message) => {
    vi.mocked(performHealthCheck).mockResolvedValue(report(status));
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(code);
    expect(res.json()).toEqual({ success: true, message, data: { status } });
    for (const leak of ['checks', 'responseTime', 'heap', 'uptime', 'version', '1.2.3', 'abc1234', 'Redis', 'environment']) {
      expect(res.body).not.toContain(leak);
    }
  });
});

describe('GET /api/v1/ready and /api/v1/live (unchanged)', () => {
  it('/ready answers { ready, timestamp }, 503 when not ready', async () => {
    vi.mocked(checkReadiness).mockResolvedValue(true);
    const up = await app.inject({ method: 'GET', url: '/api/v1/ready' });
    expect(up.statusCode).toBe(200);
    expect(up.json()).toMatchObject({ success: true, message: 'Service is ready', data: { ready: true } });
    expect(Object.keys(up.json().data)).toEqual(['ready', 'timestamp']);

    vi.mocked(checkReadiness).mockResolvedValue(false);
    const down = await app.inject({ method: 'GET', url: '/api/v1/ready' });
    expect(down.statusCode).toBe(503);
    expect(down.json()).toMatchObject({ message: 'Service not ready', data: { ready: false } });
  });

  it('/live answers { alive, timestamp } without touching the checks', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/live' });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json().data)).toEqual(['alive', 'timestamp']);
    expect(performHealthCheck).not.toHaveBeenCalled();
    expect(checkReadiness).not.toHaveBeenCalled();
  });
});
