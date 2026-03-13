import { z } from 'zod';

export const blockIpSchema = z.object({
  ip: z.union([z.ipv4(), z.ipv6()], { message: 'Invalid IP address' }),
  reason: z.string().max(500).optional(),
});

export const unblockIpParamsSchema = z.object({
  ip: z.string().min(1, 'IP address is required'),
});

export type BlockIpInput = z.infer<typeof blockIpSchema>;
export type UnblockIpParams = z.infer<typeof unblockIpParamsSchema>;
