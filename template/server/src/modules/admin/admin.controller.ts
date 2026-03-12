import type { FastifyRequest, FastifyReply } from 'fastify';
import { successResponse } from '@shared/responses/successResponse.js';
import { ValidationError } from '@shared/errors/errors.js';
import { blockIp, unblockIp, getBlockedIps } from '@libs/ip-block.js';
import { blockIpSchema } from './admin.schemas.js';

import type { BlockIpInput, UnblockIpParams } from './admin.schemas.js';

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
