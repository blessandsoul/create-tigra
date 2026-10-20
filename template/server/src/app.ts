import Fastify, { type FastifyInstance, type FastifyRequest, type RouteOptions } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { env } from '@config/env.js';
import { markRequestStart, logRequestLine } from '@libs/requestLogger.js';
import { initAuth } from '@libs/auth.js';
import { registerQueryCounter } from '@libs/query-counter.js';
import { authRoutes } from '@modules/auth/auth.routes.js';
import { usersRoutes } from '@modules/users/users.routes.js';
import { adminRoutes } from '@modules/admin/admin.routes.js';
import { filesRoutes } from '@modules/files/files.routes.js';
import { fileStorageService } from '@libs/storage/file-storage.service.js';
import { MULTIPART_LIMITS } from '@libs/storage/file-validator.js';
import { registerJobs } from '@jobs/index.js';
import { RATE_LIMIT_ENABLED } from '@config/rate-limit.config.js';
import { getIpBlock, syncBlockedIpsToRedis } from '@libs/ip-block.js';
import { MONITORING_PATHS, registerNotFoundHandler, registerRateLimiting } from '@libs/rate-limiting.js';
import { getRedis, onRedisReady } from '@libs/redis.js';
import { getClientIp, TRUSTED_PROXY_RANGES } from '@libs/client-ip.js';
import { isOriginAllowed } from '@libs/origin-check.js';
import { registerErrorHandler } from '@libs/error-handler.js';
import { registerHealthRoutes } from '@libs/health-routes.js';
import { requestIdFrom } from '@libs/request-id.js';
import { ForbiddenError, describeWait } from '@shared/errors/errors.js';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

// Import types to register Fastify augmentations
import type {} from '@shared/types/index.js';

export interface BuildAppOptions {
  /**
   * Called for every route as it is registered (Fastify's onRoute hook, added
   * before any plugin or route, so it sees all of them). Tests only: the route
   * contract uses it to fail on a route that no test calls
   * (src/test/integration-helpers.ts, routeCoverage). server.ts never sets it.
   */
  onRoute?: (route: RouteOptions) => void;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    // Request-id correlation: honour an inbound X-Request-Id (set by a reverse
    // proxy / upstream service) so logs and Sentry events share one id across
    // hops, but only a short plain one; otherwise mint a UUID. See libs/request-id.ts.
    genReqId: (req) => requestIdFrom(req.headers['x-request-id']),
    // Trust X-Forwarded-* only from our own proxy (loopback / private networks, i.e. Coolify's
    // Traefik), in every environment. request.ip is then the right-most untrusted hop, never an
    // entry the visitor wrote. `true` here would trust every hop, letting any client choose its
    // own rate-limit and block key. Cloudflare is handled in libs/client-ip.ts.
    trustProxy: TRUSTED_PROXY_RANGES,
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

  // First, so it runs for every route registered below (plugins included).
  const { onRoute } = options;
  if (onRoute) app.addHook('onRoute', (route) => onRoute(route as RouteOptions));

  // Set Zod validator and serializer
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // --- Plugins ---
  // CORS: Allow all origins in development, the checked CORS_ORIGIN list
  // otherwise (env.CORS_ORIGINS: bare origins, validated at boot in env.ts).
  const corsOrigin: true | string[] = env.NODE_ENV === 'development' ? true : env.CORS_ORIGINS;

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


  // Rate limiting: the default-limit hook + @fastify/rate-limit, Redis-backed so every
  // server process shares the counters. Before any route. See src/libs/rate-limiting.ts.
  await registerRateLimiting(app, RATE_LIMIT_ENABLED ? { redis: getRedis() } : {});

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

  // File upload handling (multipart/form-data). The field and part caps keep
  // one request from making the server buffer ~1 GB of form fields before the
  // file (see MULTIPART_LIMITS in libs/storage/file-validator.ts).
  await app.register(multipart, {
    limits: {
      fileSize: env.MAX_FILE_SIZE_MB * 1024 * 1024, // ENV-configurable (default 10MB)
      files: 1, // Only one file per request
      ...MULTIPART_LIMITS,
    },
  });

  // Initialize file storage (create both upload tiers) BEFORE mounting static,
  // so the public root exists when @fastify/static checks it.
  await fileStorageService.initialize();
  // Production container without an uploads volume: say so loudly, every
  // deploy would otherwise delete all avatars without a word.
  fileStorageService.warnIfUploadsNotPersistent();

  // Static file serving for uploads — PUBLIC tier ONLY.
  // SECURITY: the root is scoped to UPLOAD_PUBLIC_DIR (uploads/public), NOT the
  // whole uploads/ tree. The PRIVATE tier (uploads/private) lives OUTSIDE this
  // root and is unreachable through /uploads/* — it is served only by the
  // auth-gated, owner-scoped route GET /api/v1/files/:filename (filesRoutes).
  // Serving UPLOAD_PUBLIC_DIR at prefix '/uploads/' puts avatars at
  // /uploads/users/{id}/avatar/avatar-<hex>.webp.
  // Cached for a year, immutable: a public file never changes under its name
  // (every new avatar gets a new random name, see file-storage.service.ts), so
  // browsers and CDNs never need to re-check it. Anything else written to the
  // public tier must follow the same rule.
  await app.register(fastifyStatic, {
    root: fileStorageService.getPublicDir(),
    prefix: '/uploads/',
    maxAge: 365 * 24 * 60 * 60 * 1000, // ms
    immutable: true,
  });

  // --- Sync permanent IP blocks from DB to Redis ---
  await syncBlockedIpsToRedis();
  // Permanent blocks live in MySQL and are only *enforced* through Redis. A
  // restarted Redis (or one that was down at boot) comes back without them, so
  // re-sync on every reconnect instead of waiting for a server restart.
  // syncBlockedIpsToRedis never throws (it logs and returns on failure).
  const stopResyncOnReconnect = onRedisReady(() => {
    void syncBlockedIpsToRedis();
  });
  app.addHook('onClose', async () => {
    stopResyncOnReconnect();
  });

  // --- Request-id echo: surface request.id on the response so a client/proxy
  // can correlate a failed call with the server log + Sentry event. Runs first
  // so the header is present even when a later hook short-circuits (IP block,
  // origin check). request.id is the genReqId value (inbound X-Request-Id or UUID).
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  // --- IP Block Check (runs before everything else) ---
  app.addHook('onRequest', async (request: FastifyRequest) => {
    if (MONITORING_PATHS.has(request.url.split('?')[0])) {
      return; // never block health probes
    }
    const block = await getIpBlock(getClientIp(request));
    if (!block.blocked) return;
    if (block.permanent) {
      throw new ForbiddenError('Access from your network is blocked.', 'IP_BLOCKED');
    }
    throw new ForbiddenError(
      `Too many requests from your network. Try again in ${describeWait(block.retryAfterSeconds)}.`,
      'IP_BLOCKED',
      block.retryAfterSeconds,
    );
  });

  // --- CSRF defense-in-depth: Origin check on state-changing methods ---
  // Second line behind the SameSite cookies (src/libs/cookies.ts): if a browser
  // sends an Origin header on a state-changing request, it must be same-origin
  // or a configured CORS origin (e.g. not a compromised sibling subdomain). Requests WITHOUT an Origin header (curl, Postman, server-to-server,
  // health probes) are allowed — they carry no ambient cookies and are not
  // CSRF vectors. See src/libs/origin-check.ts for the full rationale.
  const stateChangingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  const allowAllOrigins = corsOrigin === true;
  const allowedOrigins = new Set<string>(Array.isArray(corsOrigin) ? corsOrigin : []);

  app.addHook('onRequest', async (request: FastifyRequest) => {
    if (!stateChangingMethods.has(request.method)) return;
    if (isOriginAllowed(request.headers.origin, request.headers.host, allowedOrigins, allowAllOrigins)) return;
    throw new ForbiddenError('Origin not allowed', 'ORIGIN_NOT_ALLOWED');
  });

  // --- Request/Response Logging ---
  app.addHook('preHandler', async (request) => {
    const pathname = request.url.split('?')[0];
    if (!MONITORING_PATHS.has(pathname)) {
      markRequestStart(request);
    }
  });

  app.addHook('onResponse', async (request, reply) => {
    const pathname = request.url.split('?')[0];
    if (!MONITORING_PATHS.has(pathname)) {
      logRequestLine(request, reply);
    }
  });

  // --- Global Error Handler (must be set before routes): see src/libs/error-handler.ts ---
  registerErrorHandler(app);

  // --- Unknown URLs: error envelope + DEFAULT_LIMIT (see src/libs/rate-limiting.ts) ---
  registerNotFoundHandler(app);

  // --- Monitoring & Health Checks: public /health, /ready, /live (see src/libs/health-routes.ts) ---
  // The full report is admin-only: GET /api/v1/admin/health (modules/admin).
  registerHealthRoutes(app);

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
