import type { FastifyInstance } from 'fastify';
import { authenticate, authorize } from '@libs/auth.js';
import { RATE_LIMITS } from '@config/rate-limit.config.js';
import * as adminController from './admin.controller.js';

export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  // All admin routes require authentication + ADMIN role
  fastify.addHook('preValidation', authenticate);
  fastify.addHook('preValidation', authorize('ADMIN'));

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
    config: { rateLimit: RATE_LIMITS.ADMIN_DEFAULT },
    handler: adminController.unblockIpHandler,
  });
}
