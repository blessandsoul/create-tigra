'use client';

import type React from 'react';
import { useEffect } from 'react';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AppLink } from '@/components/common/AppLink';
import { useAuth } from '../hooks/useAuth';
import { LimitNotice } from './LimitNotice';
import { ROUTES } from '@/lib/constants/routes';
import { cn } from '@/lib/utils';
import { applyFieldErrors } from '@/lib/utils/form';

// Mirrors the server's registerSchema (server src/modules/auth/auth.schemas.ts),
// limits and messages alike: change both together. Whatever the server still
// refuses comes back as a 422 and lands under its field (applyFieldErrors).
const registerSchema = z
  .object({
    firstName: z.string().trim().min(2, 'First name must be at least 2 characters').max(100, 'First name must be at most 100 characters'),
    lastName: z.string().trim().min(2, 'Last name must be at least 2 characters').max(100, 'Last name must be at most 100 characters'),
    email: z.string().min(1, 'Email is required').email('Invalid email address'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(128, 'Password must be at most 128 characters')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
      .regex(/[0-9]/, 'Password must contain at least one number'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type RegisterFormData = z.infer<typeof registerSchema>;

export const RegisterForm = (): React.ReactElement => {
  const { register: registerUser, isRegistering, registerError } = useAuth();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
  });

  // The server's 422 verdict lands under its field (lib/utils/form.ts).
  useEffect(() => {
    applyFieldErrors(registerError, setError, ['firstName', 'lastName', 'email', 'password']);
  }, [registerError, setError]);

  const onSubmit = (data: RegisterFormData): void => {
    registerUser({
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      password: data.password,
    });
  };

  return (
    <div className="mx-auto w-full max-w-sm space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Create an account</h1>
        <p className="text-sm text-muted-foreground">
          Enter your details to get started
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="firstName">First name</Label>
            <Input
              id="firstName"
              placeholder="John"
              autoComplete="given-name"
              aria-invalid={!!errors.firstName}
              aria-describedby={errors.firstName ? 'firstName-error' : undefined}
              {...register('firstName')}
              className={cn(errors.firstName && 'border-destructive')}
            />
            {errors.firstName && (
              <p id="firstName-error" className="text-sm text-destructive">{errors.firstName.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="lastName">Last name</Label>
            <Input
              id="lastName"
              placeholder="Doe"
              autoComplete="family-name"
              aria-invalid={!!errors.lastName}
              aria-describedby={errors.lastName ? 'lastName-error' : undefined}
              {...register('lastName')}
              className={cn(errors.lastName && 'border-destructive')}
            />
            {errors.lastName && (
              <p id="lastName-error" className="text-sm text-destructive">{errors.lastName.message}</p>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? 'reg-email-error' : undefined}
            {...register('email')}
            className={cn(errors.email && 'border-destructive')}
          />
          {errors.email && (
            <p id="reg-email-error" className="text-sm text-destructive">{errors.email.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            placeholder="Min 8 characters"
            autoComplete="new-password"
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? 'reg-password-error' : undefined}
            {...register('password')}
            className={cn(errors.password && 'border-destructive')}
          />
          {errors.password && (
            <p id="reg-password-error" className="text-sm text-destructive">{errors.password.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <Input
            id="confirmPassword"
            type="password"
            placeholder="Repeat your password"
            autoComplete="new-password"
            aria-invalid={!!errors.confirmPassword}
            aria-describedby={errors.confirmPassword ? 'confirmPassword-error' : undefined}
            {...register('confirmPassword')}
            className={cn(errors.confirmPassword && 'border-destructive')}
          />
          {errors.confirmPassword && (
            <p id="confirmPassword-error" className="text-sm text-destructive">
              {errors.confirmPassword.message}
            </p>
          )}
        </div>

        {/* Rate limit or email cap, with the wait time (no toast for these). */}
        <LimitNotice error={registerError} />

        <Button type="submit" className="w-full" disabled={isRegistering}>
          {isRegistering ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating account...
            </>
          ) : (
            'Create account'
          )}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <AppLink
          href={ROUTES.LOGIN}
          className="font-medium text-primary transition-colors duration-150 active:opacity-70 md:hover:text-primary/80"
        >
          Sign in
        </AppLink>
      </p>
    </div>
  );
};
