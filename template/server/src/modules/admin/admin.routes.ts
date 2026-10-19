import type { FastifyInstance } from 'fastify';
import { authenticate, authorize } from '@libs/auth.js';
import { RATE_LIMITS } from '@config/rate-limit.config.js';
import * as adminController from './admin.controller.js';
import {
  blockIpSchema,
  unblockIpParamsSchema,
  getUsersQuerySchema,
  userIdParamsSchema,
  updateUserStatusSchema,
  updateUserRoleSchema,
  getSessionsQuerySchema,
  sessionIdParamsSchema,
} from './admin.schemas.js';

export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  // All admin routes require authentication + ADMIN role
  fastify.addHook('preValidation', authenticate);
  fastify.addHook('preValidation', authorize('ADMIN'));

  // ─── IP Blocking ────────────────────────────────────────────────────────

  /**
   * List blocked IPs
   *
   * GET /api/v1/admin/blocked-ips
   * Auth: Required (ADMIN)
   * Returns: { permanent: string[], autoBlocked: string[] }
   */
  fastify.get('/admin/blocked-ips', {
    config: { rateLimit: RATE_LIMITS.ADMIN_DEFAULT },
    handler: adminController.listBlockedIps,
  });

  /**
   * Show the address the server resolves for THIS request, and where it came from.
   * Used after a deploy or a proxy/CDN change to confirm rate limits and IP blocks see the real
   * visitor (source "cloudflare" behind Cloudflare, "proxy" behind Traefik alone), never a
   * Cloudflare, Docker or proxy address. Returns nothing else (no headers are echoed).
   *
   * GET /api/v1/admin/client-ip
   * Auth: Required (ADMIN)
   * Returns: { ip: string, source: 'cloudflare' | 'cloudflare-unverified' | 'proxy' | 'socket' }
   */
  fastify.get('/admin/client-ip', {
    config: { rateLimit: RATE_LIMITS.ADMIN_DEFAULT },
    handler: adminController.getResolvedClientIp,
  });

  /**
   * Block an IP address (permanent)
   *
   * POST /api/v1/admin/blocked-ips
   * Auth: Required (ADMIN)
   * Body: { ip: string }
   */
  fastify.post('/admin/blocked-ips', {
    schema: { body: blockIpSchema },
    config: { rateLimit: RATE_LIMITS.ADMIN_DEFAULT },
    handler: adminController.blockIpHandler,
  });

  /**
   * Unblock an IP address
   *
   * DELETE /api/v1/admin/blocked-ips/:ip
   * Auth: Required (ADMIN)
   */
  fastify.delete('/admin/blocked-ips/:ip', {
    schema: { params: unblockIpParamsSchema },
    config: { rateLimit: RATE_LIMITS.ADMIN_DEFAULT },
    handler: adminController.unblockIpHandler,
  });

  // ─── Health ───────────────────────────────────────────────────────────

  /**
   * Full health report: per-check status and timings for the database and
   * Redis (cached for 5 s, see libs/monitoring.ts), memory against the heap
   * limit, uptime, checkedAt, version and deployed commit. The public
   * GET /api/v1/health answers only { status }.
   *
   * GET /api/v1/admin/health
   * Auth: Required (ADMIN)
   * Returns: { status, checks: { database, redis, memory, uptime }, timestamp, checkedAt, version, commit, environment }
   */
  fastify.get('/admin/health', {
    config: { rateLimit: RATE_LIMITS.ADMIN_DEFAULT },
    handler: adminController.getHealthReport,
  });

  // ─── Dashboard Stats ──────────────────────────────────────────────────

  /**
   * Get dashboard statistics
   *
   * GET /api/v1/admin/stats
   * Auth: Required (ADMIN)
   * Returns: { totalUsers, activeUsers, adminCount, recentSignups, activeSessions }
   */
  fastify.get('/admin/stats', {
    config: { rateLimit: RATE_LIMITS.ADMIN_DEFAULT },
    handler: adminController.getDashboardStats,
  });

  // ─── User Management ─────────────────────────────────────────────────

  /**
   * List users (paginated, filterable)
   *
   * GET /api/v1/admin/users
   * Auth: Required (ADMIN)
   * Query: ?page=1&limit=10&search=&role=&isActive=&sortBy=createdAt&sortOrder=desc&deleted=false
   * deleted=true lists ONLY soft-deleted accounts, each with purgeAt (when the purge removes it)
   */
  fastify.get('/admin/users', {
    schema: { querystring: getUsersQuerySchema },
    config: { rateLimit: RATE_LIMITS.ADMIN_DEFAULT },
    handler: adminController.getUsers,
  });

  /**
   * Get user detail
   *
   * GET /api/v1/admin/users/:userId
   * Auth: Required (ADMIN)
   * Returns: User with sessionCount and lastActiveAt (latest activity of a still-existing session)
   */
  fastify.get('/admin/users/:userId', {
    schema: { params: userIdParamsSchema },
    config: { rateLimit: RATE_LIMITS.ADMIN_DEFAULT },
    handler: adminController.getUserDetail,
  });

  /**
   * Toggle user active status
   *
   * PATCH /api/v1/admin/users/:userId/status
   * Auth: Required (ADMIN)
   * Body: { isActive: boolean }
   * Side effect: deactivating also invalidates all sessions
   */
  fastify.patch('/admin/users/:userId/status', {
    schema: { params: userIdParamsSchema, body: updateUserStatusSchema },
    config: { rateLimit: RATE_LIMITS.ADMIN_DEFAULT },
    handler: adminController.updateUserStatus,
  });

  /**
   * Restore a soft-deleted account (until the 30-day purge removes it)
   *
   * POST /api/v1/admin/users/:userId/restore
   * Auth: Required (ADMIN)
   * 200 with the user; 404 USER_NOT_FOUND (none, or already purged); 409 USER_NOT_DELETED
   */
  fastify.post('/admin/users/:userId/restore', {
    schema: { params: userIdParamsSchema },
    config: { rateLimit: RATE_LIMITS.ADMIN_DEFAULT },
    handler: adminController.restoreUser,
  });

  /**
   * Change user role
   *
   * PATCH /api/v1/admin/users/:userId/role
   * Auth: Required (ADMIN)
   * Body: { role: 'USER' | 'ADMIN' }
   * Side effect: demoting ADMIN also invalidates their sessions
   * Protection: cannot change your own role
   */
  fastify.patch('/admin/users/:userId/role', {
    schema: { params: userIdParamsSchema, body: updateUserRoleSchema },
    config: { rateLimit: RATE_LIMITS.ADMIN_DEFAULT },
    handler: adminController.updateUserRole,
  });

  // ─── Session Management ───────────────────────────────────────────────

  /**
   * List active sessions (paginated)
   *
   * GET /api/v1/admin/sessions
   * Auth: Required (ADMIN)
   * Query: ?page=1&limit=10&userId=
   */
  fastify.get('/admin/sessions', {
    schema: { querystring: getSessionsQuerySchema },
    config: { rateLimit: RATE_LIMITS.ADMIN_DEFAULT },
    handler: adminController.getAllSessions,
  });

  /**
   * Force-expire a session
   *
   * DELETE /api/v1/admin/sessions/:sessionId
   * Auth: Required (ADMIN)
   * Side effect: also deletes associated refresh tokens
   */
  fastify.delete('/admin/sessions/:sessionId', {
    schema: { params: sessionIdParamsSchema },
    config: { rateLimit: RATE_LIMITS.ADMIN_DEFAULT },
    handler: adminController.forceExpireSession,
  });
}
