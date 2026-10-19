/**
 * Users Module Zod Schemas
 *
 * Validation schemas for user endpoints.
 */

import { z } from 'zod';

/**
 * Schema for :userId URL parameter
 *
 * Reused across all routes that take :userId in the URL.
 */
export const UserIdParamSchema = z.object({
  userId: z.string().uuid({ message: 'Invalid user ID format' }),
});

/** Alias for backward compatibility */
export const GetUserAvatarSchema = UserIdParamSchema;

/**
 * Schema for updating user profile
 *
 * Both fields optional, but at least one must be sent. That rule lives here,
 * not in the service, so an empty update is wrong input like any other:
 * 422 VALIDATION_FAILED naming both fields. trim() runs FIRST (Zod 4 runs the
 * steps in order; a length check before it let "   " become an empty name).
 */
export const UpdateProfileSchema = z
  .object({
    firstName: z.string().trim().min(2, 'First name must be at least 2 characters').max(100).optional(),
    lastName: z.string().trim().min(2, 'Last name must be at least 2 characters').max(100).optional(),
  })
  .superRefine((input, ctx) => {
    if (input.firstName !== undefined || input.lastName !== undefined) return;
    for (const field of ['firstName', 'lastName'] as const) {
      ctx.addIssue({ code: 'custom', path: [field], message: 'Send a first name or a last name' });
    }
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
 * Schema for admin-initiated password change
 *
 * Admin does not need to provide the user's current password.
 */
export const AdminChangePasswordSchema = z.object({
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
});

/**
 * Type inference from schemas
 */
export type UserIdParams = z.infer<typeof UserIdParamSchema>;
export type GetUserAvatarParams = UserIdParams;
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;
export type AdminChangePasswordInput = z.infer<typeof AdminChangePasswordSchema>;
export type DeleteAccountInput = z.infer<typeof DeleteAccountSchema>;
