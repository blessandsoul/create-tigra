import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { successResponse } from '@shared/responses/successResponse.js';
import { ValidationError } from '@shared/errors/errors.js';
import { blockIp, unblockIp, getBlockedIps } from '@libs/ip-block.js';

const blockIpSchema = z.object({
  ip: z.string().ip({ message: 'Invalid IP address' }),
});

type BlockIpBody = z.infer<typeof blockIpSchema>;
type UnblockIpParams = { ip: string };

export async function listBlockedIps(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { permanent, autoBlocked } = await getBlockedIps();
  reply.send(successResponse('Blocked IPs retrieved', { permanent, autoBlocked }));
}

export async function blockIpHandler(
  request: FastifyRequest<{ Body: BlockIpBody }>,
  reply: FastifyReply,
): Promise<void> {
  const parsed = blockIpSchema.safeParse(request.body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid IP address', 'INVALID_IP');
  }
  await blockIp(parsed.data.ip);
  reply.status(201).send(successResponse('IP blocked successfully', { ip: parsed.data.ip }));
}

export async function unblockIpHandler(
  request: FastifyRequest<{ Params: UnblockIpParams }>,
  reply: FastifyReply,
): Promise<void> {
  const { ip } = request.params;
  await unblockIp(ip);
  reply.send(successResponse('IP unblocked successfully', { ip }));
}
