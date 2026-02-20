import { z } from 'zod';

export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export type PaginationInput = z.infer<typeof PaginationSchema>;

export function calculateOffset(page: number, limit: number): number {
  return (page - 1) * limit;
}
