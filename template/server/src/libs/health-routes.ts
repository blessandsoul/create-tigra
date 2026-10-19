import type { FastifyInstance } from 'fastify';
import { successResponse } from '@shared/responses/successResponse.js';
import { performHealthCheck, checkReadiness, checkLiveness } from '@libs/monitoring.js';

/**
 * The public probes, for uptime monitors, load balancers and Docker:
 *
 * - GET /api/v1/health: overall status only ({ status }); 200 healthy or
 *   degraded, 503 unhealthy (database down). Anyone can call it, so it says
 *   nothing about the internals: no response times, memory, uptime, versions,
 *   and no hint that Redis (and with it rate limits and IP blocks) is down
 *   beyond "degraded". The full report is admin-only: GET /api/v1/admin/health.
 * - GET /api/v1/ready: { ready, timestamp }; 503 while the database is down.
 * - GET /api/v1/live: { alive, timestamp }; the Dockerfile HEALTHCHECK.
 *
 * All three are in MONITORING_PATHS (libs/rate-limiting.ts): never rate
 * limited or IP-blocked, and not request-logged. /health and /ready share one
 * cached database check (libs/monitoring.ts), so probing them costs at most
 * one query per 5 s.
 */
export function registerHealthRoutes(app: FastifyInstance): void {
  app.get('/api/v1/health', { config: { rateLimit: false } }, async (_request, reply) => {
    const { status } = await performHealthCheck();
    const statusCode = status === 'unhealthy' ? 503 : 200;
    const message =
      status === 'healthy'
        ? 'All systems operational'
        : status === 'degraded'
          ? 'Some systems degraded'
          : 'System unhealthy';
    return reply.status(statusCode).send(successResponse(message, { status }));
  });

  app.get('/api/v1/ready', { config: { rateLimit: false } }, async (_request, reply) => {
    const ready = await checkReadiness();
    return reply.status(ready ? 200 : 503).send(
      successResponse(ready ? 'Service is ready' : 'Service not ready', {
        ready,
        timestamp: new Date().toISOString(),
      }),
    );
  });

  app.get('/api/v1/live', { config: { rateLimit: false } }, (_request, reply) => {
    const alive = checkLiveness();
    return reply.status(alive ? 200 : 503).send(
      successResponse(alive ? 'Service is alive' : 'Service not alive', {
        alive,
        timestamp: new Date().toISOString(),
      }),
    );
  });
}
