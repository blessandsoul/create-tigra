/**
 * GET /api/v1/admin/health behind the REAL admin gate (authenticate +
 * authorize('ADMIN') from libs/auth.ts, @fastify/jwt): 401 without a token,
 * 403 for a USER, 200 with the full report for an ADMIN. Only the session
 * lookup and the checks are mocked.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@libs/prisma.js';
import { performHealthCheck } from '@libs/monitoring.js';
import { initAuth } from '@libs/auth.js';
import { registerErrorHandler } from '@libs/error-handler.js';
import { adminRoutes } from '../admin.routes.js';

vi.mock('@libs/prisma.js', () => ({
  prisma: { session: { findFirst: vi.fn() }, user: { findUnique: vi.fn() } },
}));
vi.mock('@libs/monitoring.js', () => ({ performHealthCheck: vi.fn() }));

const fullReport = {
  status: 'degraded' as const,
  checks: {
    database: { status: 'up' as const, responseTime: 3 },
    redis: { status: 'down' as const, message: 'Redis connection failed (non-fatal)' },
    memory: { status: 'up' as const, details: { heapUsedMB: 50, heapLimitMB: 4096 } },
    uptime: { status: 'up' as const, details: { uptimeSeconds: 99 } },
  },
  timestamp: '2026-10-20T00:00:00.000Z',
  checkedAt: '2026-10-20T00:00:00.000Z',
  version: '1.2.3',
  commit: 'abc1234def56',
  environment: 'test',
};

let app: FastifyInstance;

/** A signed access token whose session lookup answers with `role`. */
function tokenFor(role: 'USER' | 'ADMIN'): string {
  vi.mocked(prisma.session.findFirst).mockResolvedValue({
    user: { isActive: true, emailVerifiedAt: new Date(), deletedAt: null, role },
  } as never);
  return app.jwt.sign({ userId: `${role}-1`, role, sessionId: `${role}-session` });
}

beforeAll(async () => {
  app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(jwt, { secret: 'test-jwt-secret-must-be-at-least-32-characters-long' });
  initAuth(app);
  registerErrorHandler(app);
  await app.register(adminRoutes, { prefix: '/api/v1' });
  await app.ready();
  vi.mocked(performHealthCheck).mockResolvedValue(fullReport);
});
afterAll(() => app.close());

describe('GET /api/v1/admin/health', () => {
  it('401 without a token, and runs no check', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/health' });
    expect(res.statusCode).toBe(401);
    expect(performHealthCheck).not.toHaveBeenCalled();
  });

  it('403 for a signed-in USER', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/v1/admin/health', headers: { authorization: `Bearer ${tokenFor('USER')}` },
    });
    expect(res.statusCode).toBe(403);
    expect(performHealthCheck).not.toHaveBeenCalled();
  });

  it('200 with the full report for an ADMIN, even when degraded', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/v1/admin/health', headers: { authorization: `Bearer ${tokenFor('ADMIN')}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, message: 'Health report', data: fullReport });
  });
});
