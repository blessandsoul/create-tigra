import { z } from 'zod';

// ─── IP Blocking ────────────────────────────────────────────────────────────

export const blockIpSchema = z.object({
  ip: z.union([z.ipv4(), z.ipv6()], { message: 'Invalid IP address' }),
  reason: z.string().max(500).optional(),
});

export const unblockIpParamsSchema = z.object({
  ip: z.string().min(1, 'IP address is required'),
});

export type BlockIpInput = z.infer<typeof blockIpSchema>;
export type UnblockIpParams = z.infer<typeof unblockIpParamsSchema>;

// ─── User Management ────────────────────────────────────────────────────────

export const getUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().max(100).optional(),
  role: z.enum(['USER', 'ADMIN']).optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  sortBy: z.enum(['createdAt', 'email', 'firstName']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const userIdParamsSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
});

export const updateUserStatusSchema = z.object({
  isActive: z.boolean(),
});

export const updateUserRoleSchema = z.object({
  role: z.enum(['USER', 'ADMIN']),
});

export type GetUsersQuery = z.infer<typeof getUsersQuerySchema>;
export type UserIdParams = z.infer<typeof userIdParamsSchema>;
export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>;
export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>;

// ─── Session Management ─────────────────────────────────────────────────────

export const getSessionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  userId: z.string().uuid('Invalid user ID').optional(),
});

export const sessionIdParamsSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
});

export type GetSessionsQuery = z.infer<typeof getSessionsQuerySchema>;
export type SessionIdParams = z.infer<typeof sessionIdParamsSchema>;
