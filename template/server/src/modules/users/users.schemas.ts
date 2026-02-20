/**
 * Users Module Zod Schemas
 *
 * Validation schemas for user endpoints.
 */

import { z } from 'zod';

/**
 * Schema for getting a user's avatar
 *
 * Validates userId parameter in URL
 */
export const GetUserAvatarSchema = z.object({
  userId: z.string().uuid({ message: 'Invalid user ID format' }),
});

/**
 * Type inference from schemas
 */
export type GetUserAvatarParams = z.infer<typeof GetUserAvatarSchema>;
