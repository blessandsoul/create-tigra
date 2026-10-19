import type { FastifyRequest, FastifyReply } from 'fastify';
import { successResponse } from '@shared/responses/successResponse.js';
import { paginatedResponse } from '@shared/responses/paginatedResponse.js';
import { parseInput } from '@libs/validation-errors.js';
import { blockIp, unblockIp, getBlockedIps } from '@libs/ip-block.js';
import { getClientIp, resolveClientIp } from '@libs/client-ip.js';
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

// The route schemas in admin.routes.ts reject wrong input first. parseInput
// here is the second line: it yields the typed values and, should a route ever
// lose its schema, still answers with the standard 422 VALIDATION_FAILED.

// ─── IP Blocking ────────────────────────────────────────────────────────────

export async function listBlockedIps(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { permanent, autoBlocked } = await getBlockedIps();
  reply.send(successResponse('Blocked IPs retrieved', { permanent, autoBlocked }));
}

/** The resolved visitor address for this request and its source (see libs/client-ip.ts). */
export async function getResolvedClientIp(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { ip, source } = resolveClientIp(request);
  reply.send(successResponse('Client IP resolved', { ip, source }));
}

export async function blockIpHandler(
  request: FastifyRequest<{ Body: BlockIpInput }>,
  reply: FastifyReply,
): Promise<void> {
  const parsed = parseInput(blockIpSchema, request.body);
  // The admin's own address is passed so it can never be blocked (that would
  // lock them out of every route, the unblock route included).
  const blocked = await blockIp(parsed.ip, request.user.userId, parsed.reason, getClientIp(request));
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
  const parsed = parseInput(getUsersQuerySchema, request.query);

  const { page, limit } = parsed;
  const { items, totalItems } = await adminService.getUsers(parsed);

  reply.send(paginatedResponse('Users retrieved', items, page, limit, totalItems));
}

export async function getUserDetail(
  request: FastifyRequest<{ Params: UserIdParams }>,
  reply: FastifyReply,
): Promise<void> {
  const parsed = parseInput(userIdParamsSchema, request.params);

  const user = await adminService.getUserDetail(parsed.userId);
  reply.send(successResponse('User details retrieved', user));
}

export async function updateUserStatus(
  request: FastifyRequest<{ Params: UserIdParams; Body: UpdateUserStatusInput }>,
  reply: FastifyReply,
): Promise<void> {
  const paramsParsed = parseInput(userIdParamsSchema, request.params);

  const bodyParsed = parseInput(updateUserStatusSchema, request.body);

  const user = await adminService.toggleUserStatus(
    paramsParsed.userId,
    bodyParsed.isActive,
    request.user.userId,
  );

  const action = bodyParsed.isActive ? 'activated' : 'deactivated';
  reply.send(successResponse(`User ${action} successfully`, user));
}

export async function restoreUser(
  request: FastifyRequest<{ Params: UserIdParams }>,
  reply: FastifyReply,
): Promise<void> {
  const parsed = parseInput(userIdParamsSchema, request.params);
  const user = await adminService.restoreUser(parsed.userId);
  reply.send(successResponse('User restored successfully', user));
}

export async function updateUserRole(
  request: FastifyRequest<{ Params: UserIdParams; Body: UpdateUserRoleInput }>,
  reply: FastifyReply,
): Promise<void> {
  const paramsParsed = parseInput(userIdParamsSchema, request.params);

  const bodyParsed = parseInput(updateUserRoleSchema, request.body);

  const user = await adminService.changeUserRole(
    paramsParsed.userId,
    bodyParsed.role,
    request.user.userId,
  );

  reply.send(successResponse('User role updated successfully', user));
}

// ─── Session Management ─────────────────────────────────────────────────────

export async function getAllSessions(
  request: FastifyRequest<{ Querystring: GetSessionsQuery }>,
  reply: FastifyReply,
): Promise<void> {
  const parsed = parseInput(getSessionsQuerySchema, request.query);

  const { page, limit } = parsed;
  const { items, totalItems } = await adminService.getAllSessions(parsed);

  reply.send(paginatedResponse('Sessions retrieved', items, page, limit, totalItems));
}

export async function forceExpireSession(
  request: FastifyRequest<{ Params: SessionIdParams }>,
  reply: FastifyReply,
): Promise<void> {
  const parsed = parseInput(sessionIdParamsSchema, request.params);

  await adminService.forceExpireSession(parsed.sessionId);
  reply.send(successResponse('Session expired successfully', null));
}
