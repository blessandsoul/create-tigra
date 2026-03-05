import Fastify, { type FastifyError, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import compress from '@fastify/compress';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import { env } from '@config/env.js';
import { logger } from '@libs/logger.js';
import { markRequestStart, logRequestLine } from '@libs/requestLogger.js';
import { initAuth } from '@libs/auth.js';
import { isAppError } from '@shared/errors/AppError.js';
import { successResponse, errorResponse } from '@shared/responses/successResponse.js';
import { authRoutes } from '@modules/auth/auth.routes.js';
import { usersRoutes } from '@modules/users/users.routes.js';
import { adminRoutes } from '@modules/admin/admin.routes.js';
import { fileStorageService } from '@libs/storage/file-storage.service.js';
import { registerJobs } from '@jobs/index.js';
import { RATE_LIMIT_ENABLED, getRateLimitRedisStore } from '@config/rate-limit.config.js';
import { isIpBlocked, recordRateLimitViolation, syncBlockedIpsToRedis } from '@libs/ip-block.js';
import { ForbiddenError } from '@shared/errors/errors.js';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

// Import types to register Fastify augmentations
import type {} from '@shared/types/index.js';

export async function buildApp() {
  const app = Fastify({
    logger: false,
    // Trust proxy headers (X-Forwarded-For) for accurate client IP behind Nginx/load balancer
    trustProxy: env.NODE_ENV === 'production',
    // Graceful shutdown configuration
    forceCloseConnections: true, // Force close idle connections on shutdown
    requestTimeout: 30000, // 30s request timeout
    connectionTimeout: 60000, // 60s connection timeout
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
  });

  // Enhanced security headers for production
  await app.register(helmet, {
    global: true,
  });

  // Response compression (gzip/brotli) for performance
  await app.register(compress, {
    global: true,
    threshold: 1024, // Only compress responses > 1KB
    encodings: ['gzip', 'deflate'],
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
      onExceeded: (request: { ip: string }) => {
        recordRateLimitViolation(request.ip);
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

  // File upload handling (multipart/form-data)
  await app.register(multipart, {
    limits: {
      fileSize: env.MAX_FILE_SIZE_MB * 1024 * 1024, // ENV-configurable (default 10MB)
      files: 1, // Only one file per request
    },
  });

  // Static file serving for uploads
  // Get __dirname equivalent in ES modules
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  await app.register(fastifyStatic, {
    root: path.join(__dirname, '..', 'uploads'),
    prefix: '/uploads/',
  });

  // Initialize file storage (create directories)
  await fileStorageService.initialize();

  // --- Sync permanent IP blocks from DB to Redis ---
  await syncBlockedIpsToRedis();

  // --- IP Block Check (runs before everything else) ---
  app.addHook('onRequest', async (request: FastifyRequest) => {
    if (await isIpBlocked(request.ip)) {
      throw new ForbiddenError('Access denied', 'IP_BLOCKED');
    }
  });

  // --- Request/Response Logging ---
  const skipLogPaths = new Set(['/api/v1/health', '/api/v1/ready', '/api/v1/live']);

  app.addHook('preHandler', async (request) => {
    const pathname = request.url.split('?')[0];
    if (!skipLogPaths.has(pathname)) {
      markRequestStart(request);
    }
  });

  app.addHook('onResponse', async (request, reply) => {
    const pathname = request.url.split('?')[0];
    if (!skipLogPaths.has(pathname)) {
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

    // Unexpected error — log and return generic 500
    const requestId = request.id || 'unknown';
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

  // --- Background Jobs ---
  registerJobs(app);

  return app;
}

export default buildApp;
