import Fastify, { type FastifyError, type FastifyInstance, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { randomUUID } from 'node:crypto';
import { env } from '@config/env.js';
import { logger } from '@libs/logger.js';
import { Sentry } from '@libs/observability/sentry.js';
import { markRequestStart, logRequestLine } from '@libs/requestLogger.js';
import { initAuth } from '@libs/auth.js';
import { registerQueryCounter } from '@libs/query-counter.js';
import { isAppError } from '@shared/errors/AppError.js';
import { successResponse, errorResponse } from '@shared/responses/successResponse.js';
import { authRoutes } from '@modules/auth/auth.routes.js';
import { usersRoutes } from '@modules/users/users.routes.js';
import { adminRoutes } from '@modules/admin/admin.routes.js';
import { filesRoutes } from '@modules/files/files.routes.js';
import { fileStorageService } from '@libs/storage/file-storage.service.js';
import { registerJobs } from '@jobs/index.js';
import { RATE_LIMIT_ENABLED, getRateLimitRedisStore } from '@config/rate-limit.config.js';
import { isIpBlocked, recordRateLimitViolation, syncBlockedIpsToRedis } from '@libs/ip-block.js';
import { getClientIp } from '@libs/client-ip.js';
import { isAuthPath } from '@libs/auth-path.js';
import { isOriginAllowed } from '@libs/origin-check.js';
import { ForbiddenError } from '@shared/errors/errors.js';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

// Import types to register Fastify augmentations
import type {} from '@shared/types/index.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    // Request-id correlation: honour an inbound X-Request-Id (set by a reverse
    // proxy / upstream service) so logs and Sentry events share one id across
    // hops; otherwise mint a UUID. Works even with logger:false.
    genReqId: (req) => (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
    // Trust proxy headers (X-Forwarded-For) for accurate client IP behind Nginx/load balancer
    trustProxy: env.NODE_ENV === 'production',
    // Graceful shutdown configuration
    forceCloseConnections: true, // Force close idle connections on shutdown
    // Env-configurable timeouts (defaults: 30s request, 60s connection).
    // Long-running routes (LLM calls, exports) may need 180s+ — raise the
    // reverse proxy timeout to match. See REQUEST_TIMEOUT_MS in .env.example.
    requestTimeout: env.REQUEST_TIMEOUT_MS,
    connectionTimeout: env.CONNECTION_TIMEOUT_MS,
    keepAliveTimeout: 5000, // 5s keep-alive timeout
    // Request body size limits (prevent DoS attacks)
    bodyLimit: 1048576, // 1MB default limit (1024 * 1024)
  }).withTypeProvider<ZodTypeProvider>();

  // Set Zod validator and serializer
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // --- Plugins ---
  // CORS: Allow all origins in development, specific origin(s) in production
  const corsOrigin = env.NODE_ENV === 'development'
    ? true
    : env.CORS_ORIGIN?.includes(',')
      ? env.CORS_ORIGIN.split(',').map((o) => o.trim())
      : env.CORS_ORIGIN;

  await app.register(cors, {
    origin: corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Enhanced security headers for production
  await app.register(helmet, {
    global: true,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });


  // Rate limiting: Redis-backed when available, in-memory fallback
  if (RATE_LIMIT_ENABLED) {
    const redisStore = getRateLimitRedisStore();
    await app.register(rateLimit, {
      global: false,
      max: 100,
      timeWindow: '1 minute',
      redis: redisStore,
      nameSpace: 'rl:',
      skipOnError: true, // Gracefully degrade if Redis fails mid-request
      // Key the limiter on the real client IP (Cloudflare-aware) so users behind
      // a shared CF edge IP aren't counted as one — see src/libs/client-ip.ts.
      keyGenerator: (request: FastifyRequest) => getClientIp(request),
      onExceeded: (request: FastifyRequest) => {
        // Auth routes keep their own per-route limit + account lockout; don't let
        // a mistyped password arm the IP-wide auto-ban.
        if (isAuthPath(request)) return;
        recordRateLimitViolation(getClientIp(request));
      },
    });
  } else {
    // Register with effectively no limit so per-route configs don't error
    await app.register(rateLimit, {
      global: false,
      max: 1_000_000,
      timeWindow: '1 minute',
    });
    logger.warn('[RATE-LIMIT] Rate limiting is DISABLED (RATE_LIMIT_ENABLED=false)');
  }

  await app.register(cookie, {
    secret: env.COOKIE_SECRET || env.JWT_SECRET,
  });

  await app.register(jwt, {
    secret: env.JWT_SECRET,
    cookie: {
      cookieName: 'access_token',
      signed: false,
    },
  });

  // Initialize auth helpers after JWT plugin is registered
  initAuth(app);

  // Dev-only: count Prisma queries per request → X-Query-Count header (N+1 signal for perf-tester).
  // No-op in production. Registered early so its onRequest store is entered before any query runs.
  registerQueryCounter(app);

  // File upload handling (multipart/form-data)
  await app.register(multipart, {
    limits: {
      fileSize: env.MAX_FILE_SIZE_MB * 1024 * 1024, // ENV-configurable (default 10MB)
      files: 1, // Only one file per request
    },
  });

  // Initialize file storage (create both upload tiers) BEFORE mounting static,
  // so the public root exists when @fastify/static checks it.
  await fileStorageService.initialize();

  // Static file serving for uploads — PUBLIC tier ONLY.
  // SECURITY: the root is scoped to UPLOAD_PUBLIC_DIR (uploads/public), NOT the
  // whole uploads/ tree. The PRIVATE tier (uploads/private) lives OUTSIDE this
  // root and is unreachable through /uploads/* — it is served only by the
  // auth-gated, owner-scoped route GET /api/v1/files/:filename (filesRoutes).
  // The public avatar URL shape is unchanged: serving UPLOAD_PUBLIC_DIR at
  // prefix '/uploads/' keeps avatars at /uploads/users/{id}/avatar/x.webp.
  await app.register(fastifyStatic, {
    root: fileStorageService.getPublicDir(),
    prefix: '/uploads/',
  });

  // --- Sync permanent IP blocks from DB to Redis ---
  await syncBlockedIpsToRedis();

  // Monitoring endpoints exempt from IP blocking and request logging.
  // Health probes (Coolify/Docker/K8s/load balancers) come from infrastructure
  // IPs that must NEVER be blocked — a blocked probe IP would mark a healthy
  // container as dead and restart-loop it. Exact match on the path (query
  // string stripped) so the exemption cannot be widened by crafted URLs.
  // These paths must match the route registrations below.
  const monitoringPaths = new Set(['/api/v1/health', '/api/v1/ready', '/api/v1/live']);

  // --- Request-id echo: surface request.id on the response so a client/proxy
  // can correlate a failed call with the server log + Sentry event. Runs first
  // so the header is present even when a later hook short-circuits (IP block,
  // origin check). request.id is the genReqId value (inbound X-Request-Id or UUID).
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  // --- IP Block Check (runs before everything else) ---
  app.addHook('onRequest', async (request: FastifyRequest) => {
    if (monitoringPaths.has(request.url.split('?')[0])) {
      return; // never block health probes
    }
    if (await isIpBlocked(getClientIp(request))) {
      throw new ForbiddenError('Access denied', 'IP_BLOCKED');
    }
  });

  // --- CSRF defense-in-depth: Origin check on state-changing methods ---
  // With sameSite=none cookies (cross-origin deployments), the browser attaches
  // auth cookies to cross-site requests. If a browser sends an Origin header on
  // a state-changing request, it must be same-origin or a configured CORS
  // origin. Requests WITHOUT an Origin header (curl, Postman, server-to-server,
  // health probes) are allowed — they carry no ambient cookies and are not
  // CSRF vectors. See src/libs/origin-check.ts for the full rationale.
  const stateChangingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  const allowAllOrigins = corsOrigin === true;
  const allowedOrigins = new Set<string>(
    Array.isArray(corsOrigin) ? corsOrigin : typeof corsOrigin === 'string' ? [corsOrigin] : [],
  );

  app.addHook('onRequest', async (request: FastifyRequest) => {
    if (!stateChangingMethods.has(request.method)) return;
    if (isOriginAllowed(request.headers.origin, request.headers.host, allowedOrigins, allowAllOrigins)) return;
    throw new ForbiddenError('Origin not allowed', 'ORIGIN_NOT_ALLOWED');
  });

  // --- Request/Response Logging ---
  app.addHook('preHandler', async (request) => {
    const pathname = request.url.split('?')[0];
    if (!monitoringPaths.has(pathname)) {
      markRequestStart(request);
    }
  });

  app.addHook('onResponse', async (request, reply) => {
    const pathname = request.url.split('?')[0];
    if (!monitoringPaths.has(pathname)) {
      logRequestLine(request, reply);
    }
  });

  // --- Global Error Handler (must be set before routes) ---
  app.setErrorHandler((error: FastifyError, request, reply) => {
    // AppError — our typed errors (use duck-type check to avoid instanceof issues)
    if (isAppError(error)) {
      return reply.status(error.statusCode).send(errorResponse(error.code, error.message));
    }

    // Zod validation error
    if (error.name === 'ZodError') {
      return reply.status(422).send(errorResponse('VALIDATION_FAILED', 'Validation failed'));
    }

    // Fastify validation error
    if (error.validation) {
      return reply.status(400).send(
        errorResponse(
          'BAD_REQUEST',
          error.message || 'Invalid request',
        ),
      );
    }

    // Fastify plugin errors (file size, rate limiting, etc.)
    // These have statusCode properties but aren't AppError instances
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      // Map common Fastify error codes to user-friendly messages
      const errorCodeMap: Record<number, { code: string; message: string }> = {
        413: { code: 'FILE_TOO_LARGE', message: 'File size exceeds the maximum allowed limit' },
        429: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests. Please try again later' },
      };

      const errorInfo = errorCodeMap[error.statusCode] || {
        code: 'BAD_REQUEST',
        message: error.message || 'Bad request',
      };

      return reply.status(error.statusCode).send(errorResponse(errorInfo.code, errorInfo.message));
    }

    // Unexpected error — capture in Sentry (safe no-op when SDK uninitialized),
    // then log and return a generic 500. reqId ties the event to the log line.
    const requestId = request.id || 'unknown';
    Sentry.captureException(error, { extra: { reqId: requestId } });
    logger.error(
      {
        err: error,
        requestId,
        url: request.url,
        method: request.method,
        stack: error.stack,
      },
      `Unhandled error [${requestId}]: ${error.message}`,
    );

    return reply.status(500).send(errorResponse('INTERNAL_ERROR', 'Internal server error'));
  });

  // --- Monitoring & Health Checks ---
  const { performHealthCheck, checkReadiness, checkLiveness } = await import('@libs/monitoring.js');

  // Comprehensive health check (DB + Redis + Memory + Uptime)
  app.get('/api/v1/health', async (_request, reply) => {
    const health = await performHealthCheck();

    const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;

    return reply.status(statusCode).send(
      successResponse(
        health.status === 'healthy'
          ? 'All systems operational'
          : health.status === 'degraded'
            ? 'Some systems degraded'
            : 'System unhealthy',
        health,
      ),
    );
  });

  // Readiness probe (for load balancers / K8s)
  app.get('/api/v1/ready', async (_request, reply) => {
    const ready = await checkReadiness();
    const statusCode = ready ? 200 : 503;
    return reply.status(statusCode).send(
      successResponse(ready ? 'Service is ready' : 'Service not ready', {
        ready,
        timestamp: new Date().toISOString(),
      })
    );
  });

  // Liveness probe (for container orchestration)
  app.get('/api/v1/live', (_request, reply) => {
    const alive = checkLiveness();
    const statusCode = alive ? 200 : 503;
    return reply.status(statusCode).send(
      successResponse(alive ? 'Service is alive' : 'Service not alive', {
        alive,
        timestamp: new Date().toISOString(),
      })
    );
  });

  // --- Routes ---
  await app.register(authRoutes, { prefix: '/api/v1' });
  await app.register(usersRoutes, { prefix: '/api/v1' });
  await app.register(adminRoutes, { prefix: '/api/v1' });
  await app.register(filesRoutes, { prefix: '/api/v1' });

  // --- Background Jobs ---
  registerJobs(app);

  return app;
}

export default buildApp;
