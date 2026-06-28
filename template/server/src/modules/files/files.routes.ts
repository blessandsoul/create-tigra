/**
 * Files Routes
 *
 * Auth-gated streaming of PRIVATE-tier files. This is the ONLY way to read a
 * file stored under UPLOAD_PRIVATE_DIR — that directory is deliberately NOT
 * served by @fastify/static (see app.ts), so a private file can never leak
 * through /uploads/*.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { filesController } from './files.controller.js';
import { authenticate } from '@libs/auth.js';
import { RATE_LIMITS } from '@config/rate-limit.config.js';

// Params are intentionally validated as a plain string here — the security
// checks (separator / `..` / null-byte rejection + path containment) live in
// the controller so a violation maps to 404 (no existence leak) rather than the
// 400 a Zod-level regex rejection would produce.
const GetPrivateFileParamsSchema = z.object({
  filename: z.string().min(1),
});

export async function filesRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * Get a private file (owner-scoped, auth required)
   *
   * GET /api/v1/files/:filename
   * Auth: Required (JWT) — 401 if unauthenticated.
   * Serves UPLOAD_PRIVATE_DIR/users/{authenticatedUserId}/:filename.
   * Honors a Range header (206 partial content); 404 on any miss/violation.
   */
  fastify.get<{ Params: { filename: string } }>(
    '/files/:filename',
    {
      preValidation: [authenticate],
      schema: {
        params: GetPrivateFileParamsSchema,
      },
      config: {
        rateLimit: RATE_LIMITS.FILES_GET,
      },
    },
    filesController.getPrivateFile.bind(filesController),
  );
}
