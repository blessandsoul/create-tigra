import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyError, type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import type { Redis } from 'ioredis';
import { registerRateLimiting, registerNotFoundHandler } from '../rate-limiting.js';
import { TRUSTED_PROXY_RANGES } from '../client-ip.js';
import { recordRateLimitViolation } from '../ip-block.js';
import { isAppError } from '@shared/errors/AppError.js';
import { describeWait } from '@shared/errors/errors.js';
import { errorResponse } from '@shared/responses/successResponse.js';
import { DEFAULT_LIMIT } from '@config/rate-limit.config.js';

// Strikes are asserted, never stored: no Redis in unit tests.
vi.mock('../ip-block.js', () => ({ recordRateLimitViolation: vi.fn() }));

const VISITOR = '31.146.10.20';
const OTHER_VISITOR = '31.146.10.21';

/**
 * A bare Fastify wired exactly like app.ts (same trustProxy, the same rate-limit module and
 * an error handler that serializes AppErrors the same way), with the in-memory store.
 */
async function buildTestApp(redis?: Redis): Promise<FastifyInstance> {
  const app = Fastify({ trustProxy: TRUSTED_PROXY_RANGES });
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    if (isAppError(error)) {
      return reply.status(error.statusCode).send(errorResponse(error.code, error.message, error.retryAfterSeconds));
    }
    return reply.status(500).send(errorResponse('INTERNAL_ERROR', error.message));
  });
  await registerRateLimiting(app, redis ? { redis } : {});
  registerNotFoundHandler(app);
  app.get('/api/v1/live', { config: { rateLimit: false } }, async () => ({ ok: true }));
  app.get('/api/v1/plain-a', async () => ({ ok: true })); // no own limit → DEFAULT
  app.get('/api/v1/plain-b', async () => ({ ok: true }));
  app.get('/api/v1/own', { config: { rateLimit: { max: 2, timeWindow: 60_000 } } }, async () => ({ ok: true }));
  app.post('/api/v1/auth/login', { config: { rateLimit: { max: 2, timeWindow: 60_000 } } }, async () => ({ ok: true }));
  app.get('/uploads/*', async (_request, reply) => reply.callNotFound()); // stands in for @fastify/static
  await app.ready();
  return app;
}

function hit(
  app: FastifyInstance,
  url: string,
  ip = VISITOR,
  method: 'GET' | 'POST' = 'GET',
): Promise<LightMyRequestResponse> {
  return app.inject({ method, url, remoteAddress: ip });
}

async function hitTimes(app: FastifyInstance, url: string, times: number, ip = VISITOR): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < times; i++) statuses.push((await hit(app, url, ip)).statusCode);
  return statuses;
}

describe('rate limiting wiring (src/libs/rate-limiting.ts)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('ships the default limit of 200 per minute', () => {
    expect(DEFAULT_LIMIT).toEqual({ max: 200, timeWindow: 60_000 });
  });

  it('gives a route without its own limit DEFAULT_LIMIT: request 201 → 429 with retryAfterSeconds', async () => {
    const statuses = await hitTimes(app, '/api/v1/plain-a', 200);
    expect(statuses.every((s) => s === 200)).toBe(true);
    const over = await hit(app, '/api/v1/plain-a');
    expect(over.statusCode).toBe(429);
    const body = over.json();
    expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(body.error.retryAfterSeconds).toBeGreaterThan(0);
    expect(body.error.message).toBe(`Too many requests. Try again in ${describeWait(body.error.retryAfterSeconds)}.`);
  });

  it('keeps a separate counter per route, and per visitor', async () => {
    await hitTimes(app, '/api/v1/plain-a', 201);
    expect((await hit(app, '/api/v1/plain-b')).statusCode).toBe(200); // another route
    expect((await hit(app, '/api/v1/plain-a', OTHER_VISITOR)).statusCode).toBe(200); // another visitor
  });

  it("uses a route's own limit instead of the default", async () => {
    expect(await hitTimes(app, '/api/v1/own', 3)).toEqual([200, 200, 429]);
  });

  it('answers unknown URLs with the error envelope and limits them under DEFAULT_LIMIT', async () => {
    const first = await hit(app, '/api/v1/nope');
    expect(first.statusCode).toBe(404);
    expect(first.json()).toEqual({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } });
    await hitTimes(app, '/api/v1/also-nope', 199); // all unknown URLs share one counter
    const over = await hit(app, '/api/v1/third-nope');
    expect(over.statusCode).toBe(429);
    expect(over.json().error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('never limits health probes, static /uploads/* or a missing upload', async () => {
    expect((await hitTimes(app, '/api/v1/live', 500)).every((s) => s === 200)).toBe(true);
    expect((await hitTimes(app, '/uploads/users/1/avatar/missing.webp', 500)).every((s) => s === 404)).toBe(true);
  });

  it('records an auto-block strike for an over-limit request on a normal route', async () => {
    await hitTimes(app, '/api/v1/own', 4);
    expect(recordRateLimitViolation).toHaveBeenCalledTimes(2); // requests 3 and 4
    expect(recordRateLimitViolation).toHaveBeenCalledWith(VISITOR);
  });

  it('records no strike for over-limit requests on auth routes', async () => {
    for (let i = 0; i < 4; i++) await hit(app, '/api/v1/auth/login', VISITOR, 'POST');
    expect((await hit(app, '/api/v1/auth/login', VISITOR, 'POST')).statusCode).toBe(429);
    expect(recordRateLimitViolation).not.toHaveBeenCalled();
  });
});

describe('rate limiting when Redis is down', () => {
  it('serves every request (fail open) instead of crashing', async () => {
    // A store whose every call fails, as a lost Redis connection does.
    const brokenRedis = {
      rateLimit: (...args: unknown[]) => (args.at(-1) as (err: Error) => void)(new Error('Connection is closed')),
    } as unknown as Redis;
    const app = await buildTestApp(brokenRedis);
    try {
      expect((await hitTimes(app, '/api/v1/own', 10)).every((s) => s === 200)).toBe(true);
    } finally {
      await app.close();
    }
  });
});

describe('describeWait', () => {
  it('words a wait for people, rounding minutes up', () => {
    expect(describeWait(1)).toBe('1 second');
    expect(describeWait(45)).toBe('45 seconds');
    expect(describeWait(60)).toBe('1 minute');
    expect(describeWait(61)).toBe('2 minutes');
    expect(describeWait(900)).toBe('15 minutes');
    expect(describeWait(0)).toBe('1 second');
  });
});
