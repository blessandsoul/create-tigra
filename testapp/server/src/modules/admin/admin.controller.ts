import type { FastifyRequest, FastifyReply } from 'fastify';
import { successResponse } from '@shared/responses/successResponse.js';
import { paginatedResponse } from '@shared/responses/paginatedResponse.js';
import { ValidationError } from '@shared/errors/errors.js';
import { blockIp, unblockIp, getBlockedIps } from '@libs/ip-block.js';
import { adminService } from './admin.service.js';
import {
  blockIpSchema,
  getUsersQuerySchema,
  userIdParamsSchema,
  updateUserStatusSchema,
  updateUserRoleSchema,
  getSessionsQuerySchema,
  sessionIdParamsSchema,
} from './admin.schemas.js';

import type { BlockIpInput, UnblockIpParams } from './admin.schemas.js';
import type { GetUsersQuery, UserIdParams, UpdateUserStatusInput, UpdateUserRoleInput, GetSessionsQuery, SessionIdParams } from './admin.schemas.js';

// ─── IP Blocking ────────────────────────────────────────────────────────────

export async function listBlockedIps(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { permanent, autoBlocked } = await getBlockedIps();
  reply.send(successResponse('Blocked IPs retrieved', { permanent, autoBlocked }));
}

export async function blockIpHandler(
  request: FastifyRequest<{ Body: BlockIpInput }>,
  reply: FastifyReply,
): Promise<void> {
  const parsed = blockIpSchema.safeParse(request.body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid IP address', 'INVALID_IP');
  }
  const blocked = await blockIp(parsed.data.ip, request.user.userId, parsed.data.reason);
  reply.status(201).send(successResponse('IP blocked successfully', blocked));
}

export async function unblockIpHandler(
  request: FastifyRequest<{ Params: UnblockIpParams }>,
  reply: FastifyReply,
): Promise<void> {
  const { ip } = request.params;
  await unblockIp(ip);
  reply.send(successResponse('IP unblocked successfully', { ip }));
}

// ─── Dashboard Stats ────────────────────────────────────────────────────────

export async function getDashboardStats(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const stats = await adminService.getDashboardStats();
  reply.send(successResponse('Dashboard stats retrieved', stats));
}

// ─── User Management ────────────────────────────────────────────────────────

export async function getUsers(
  request: FastifyRequest<{ Querystring: GetUsersQuery }>,
  reply: FastifyReply,
): Promise<void> {
  const parsed = getUsersQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid query parameters');
  }

  const { page, limit } = parsed.data;
  const { items, totalItems } = await adminService.getUsers(parsed.data);

  reply.send(paginatedResponse('Users retrieved', items, page, limit, totalItems));
}

export async function getUserDetail(
  request: FastifyRequest<{ Params: UserIdParams }>,
  reply: FastifyReply,
): Promise<void> {
  const parsed = userIdParamsSchema.safeParse(request.params);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid user ID');
  }

  const user = await adminService.getUserDetail(parsed.data.userId);
  reply.send(successResponse('User details retrieved', user));
}

export async function updateUserStatus(
  request: FastifyRequest<{ Params: UserIdParams; Body: UpdateUserStatusInput }>,
  reply: FastifyReply,
): Promise<void> {
  const paramsParsed = userIdParamsSchema.safeParse(request.params);
  if (!paramsParsed.success) {
    throw new ValidationError(paramsParsed.error.issues[0]?.message ?? 'Invalid user ID');
  }

  const bodyParsed = updateUserStatusSchema.safeParse(request.body);
  if (!bodyParsed.success) {
    throw new ValidationError(bodyParsed.error.issues[0]?.message ?? 'Invalid status');
  }

  const user = await adminService.toggleUserStatus(
    paramsParsed.data.userId,
    bodyParsed.data.isActive,
  );

  const action = bodyParsed.data.isActive ? 'activated' : 'deactivated';
  reply.send(successResponse(`User ${action} successfully`, user));
}

export async function updateUserRole(
  request: FastifyRequest<{ Params: UserIdParams; Body: UpdateUserRoleInput }>,
  reply: FastifyReply,
): Promise<void> {
  const paramsParsed = userIdParamsSchema.safeParse(request.params);
  if (!paramsParsed.success) {
    throw new ValidationError(paramsParsed.error.issues[0]?.message ?? 'Invalid user ID');
  }

  const bodyParsed = updateUserRoleSchema.safeParse(request.body);
  if (!bodyParsed.success) {
    throw new ValidationError(bodyParsed.error.issues[0]?.message ?? 'Invalid role');
  }

  const user = await adminService.changeUserRole(
    paramsParsed.data.userId,
    bodyParsed.data.role,
    request.user.userId,
  );

  reply.send(successResponse('User role updated successfully', user));
}

// ─── Session Management ─────────────────────────────────────────────────────

export async function getAllSessions(
  request: FastifyRequest<{ Querystring: GetSessionsQuery }>,
  reply: FastifyReply,
): Promise<void> {
  const parsed = getSessionsQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid query parameters');
  }

  const { page, limit } = parsed.data;
  const { items, totalItems } = await adminService.getAllSessions(parsed.data);

  reply.send(paginatedResponse('Sessions retrieved', items, page, limit, totalItems));
}

export async function forceExpireSession(
  request: FastifyRequest<{ Params: SessionIdParams }>,
  reply: FastifyReply,
): Promise<void> {
  const parsed = sessionIdParamsSchema.safeParse(request.params);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid session ID');
  }

  await adminService.forceExpireSession(parsed.data.sessionId);
  reply.send(successResponse('Session expired successfully', null));
}
