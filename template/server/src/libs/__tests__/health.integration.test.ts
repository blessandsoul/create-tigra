/**
 * Health probes and request logging in the real app with MySQL and Redis up
 * (the layer 8 guarantees that run in-process).
 * - Public /health answers only { status }; the full report is admin-only
 *   and judges memory against the heap limit.
 * - The database check behind /health and /ready runs at most once per 5 s,
 *   however many probes arrive (X-Query-Count shows it).
 * - Probes are never IP-blocked and never request-logged; other routes are.
 * The outage answers (Redis down, database down) are in
 * health-redis-down.integration.test.ts and health-db-down.integration.test.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, call, registerAdmin, registerUser, type TestUser } from '@/test/integration-helpers.js';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

let app: FastifyInstance;
let admin: TestUser;

beforeAll(async () => {
  app = await buildTestApp();
  admin = await registerAdmin(app, 'health-admin');
});

afterAll(async () => {
  await app?.close();
});

describe('public and admin health', () => {
  it('GET /health → 200 with only { status: "healthy" }', async () => {
    const r = await call(app, 'GET', '/health');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, message: 'All systems operational', data: { status: 'healthy' } });
  });

  it('GET /admin/health → the full report: every check, memory against the heap limit, version, commit', async () => {
    const r = await call(app, 'GET', '/admin/health', { jar: admin.jar });
    expect(r.status).toBe(200);
    const report = r.body?.data;
    expect(Object.fromEntries(Object.entries(report.checks).map(([k, v]) => [k, (v as { status: string }).status]))).toEqual({
      database: 'up',
      redis: 'up',
      memory: 'up',
      uptime: 'up',
    });
    expect(report.checks.memory.details.heapLimitMB).toBeGreaterThan(100);
    expect(report.checks.memory.message).toMatch(/of the heap limit/);
    const pkg = JSON.parse(fs.readFileSync(path.join(serverRoot, 'package.json'), 'utf8')) as { version: string };
    expect(report.version).toBe(pkg.version);
    expect(report.commit).toBeNull();
    expect(Number.isNaN(Date.parse(report.checkedAt))).toBe(false);
  });

  it('GET /admin/health: anonymous 401, USER 403', async () => {
    const user = await registerUser(app, 'health-user');
    expect((await call(app, 'GET', '/admin/health')).status).toBe(401);
    expect((await call(app, 'GET', '/admin/health', { jar: user.jar })).status).toBe(403);
  });

  it('/ready and /live keep their shapes', async () => {
    const ready = await call(app, 'GET', '/ready');
    const live = await call(app, 'GET', '/live');
    expect([ready.status, Object.keys(ready.body?.data ?? {})]).toEqual([200, ['ready', 'timestamp']]);
    expect([live.status, Object.keys(live.body?.data ?? {})]).toEqual([200, ['alive', 'timestamp']]);
  });
});

describe('the dependency check is shared', () => {
  it('one database query per 5 s, however many probes arrive', async () => {
    await new Promise((r) => setTimeout(r, 5_200)); // any earlier check has expired
    const first = await call(app, 'GET', '/health');
    const burst = await Promise.all([...Array(20)].map((_, i) => call(app, 'GET', i % 2 ? '/ready' : '/health')));
    expect(Number(first.res.headers['x-query-count'])).toBe(1);
    expect(burst.reduce((sum, r) => sum + Number(r.res.headers['x-query-count']), 0)).toBe(0);
  }, 20_000);
});

describe('probes and the edges', () => {
  it('a blocked address gets 403 elsewhere but 200 from every probe', async () => {
    const ip = '198.51.100.77';
    expect((await call(app, 'POST', '/admin/blocked-ips', { jar: admin.jar, payload: { ip } })).status).toBe(201);
    try {
      const headers = { 'x-forwarded-for': ip };
      const elsewhere = await call(app, 'GET', '/auth/me', { headers });
      expect([elsewhere.status, elsewhere.code]).toEqual([403, 'IP_BLOCKED']);
      for (const probe of ['/health', '/ready', '/live']) {
        expect([probe, (await call(app, 'GET', probe, { headers })).status]).toEqual([probe, 200]);
      }
    } finally {
      await call(app, 'DELETE', `/admin/blocked-ips/${ip}`, { jar: admin.jar });
    }
  });

  it('probes are not request-logged; other routes are, without their query string', async () => {
    const { logger } = await import('@/libs/logger.js');
    const lines: string[] = [];
    const spies = (['info', 'warn', 'error'] as const).map((level) =>
      vi.spyOn(logger, level).mockImplementation(((...args: unknown[]) => {
        lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      }) as never),
    );
    try {
      await call(app, 'GET', '/health');
      await call(app, 'GET', '/live');
      await call(app, 'GET', '/auth/me?debug=secret-query');
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    expect(lines.some((l) => /\/api\/v1\/(health|live)\b/.test(l))).toBe(false);
    const meLine = lines.find((l) => l.includes('/api/v1/auth/me'));
    expect(meLine).toBeDefined();
    expect(meLine).not.toContain('secret-query');
  });
});
