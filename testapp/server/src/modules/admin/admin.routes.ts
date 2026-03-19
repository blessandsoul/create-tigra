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
   * Query: ?page=1&limit=10&search=&role=&isActive=&sortBy=createdAt&sortOrder=desc
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
   * Returns: User with sessionCount and lastLogin
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
