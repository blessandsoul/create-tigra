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
 * Schema for updating user profile
 *
 * All fields optional — at least one must be provided (validated in service layer)
 */
export const UpdateProfileSchema = z.object({
  firstName: z.string().min(2, 'First name must be at least 2 characters').max(100).trim().optional(),
  lastName: z.string().min(2, 'Last name must be at least 2 characters').max(100).trim().optional(),
});

/**
 * Schema for changing user password
 *
 * Requires current password for verification and new password meeting strength rules
 */
export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
});

/**
 * Schema for deleting user account
 *
 * Requires password confirmation for security
 */
export const DeleteAccountSchema = z.object({
  password: z.string().min(1, 'Password is required'),
});

/**
 * Type inference from schemas
 */
export type GetUserAvatarParams = z.infer<typeof GetUserAvatarSchema>;
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;
export type DeleteAccountInput = z.infer<typeof DeleteAccountSchema>;
