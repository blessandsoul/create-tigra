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
import { useForgotPassword } from '../hooks/usePasswordReset';
import { LimitNotice } from './LimitNotice';
import { ROUTES } from '@/lib/constants/routes';
import { cn } from '@/lib/utils';
import { applyFieldErrors } from '@/lib/utils/form';

const forgotPasswordSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Invalid email address'),
});

type ForgotPasswordFormData = z.infer<typeof forgotPasswordSchema>;

/**
 * Request a password-reset link. The server answers the same way whether or not
 * the email has an account (no enumeration), so success only says "check your
 * email". Its limits (per IP, and 3 emails per hour per address) show inline,
 * with the wait time.
 */
export const ForgotPasswordForm = (): React.ReactElement => {
  const { forgotPassword, isPending, error } = useForgotPassword();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<ForgotPasswordFormData>({
    resolver: zodResolver(forgotPasswordSchema),
  });

  // The server's 422 verdict lands under its field (lib/utils/form.ts).
  useEffect(() => {
    applyFieldErrors(error, setError, ['email']);
  }, [error, setError]);

  const onSubmit = (data: ForgotPasswordFormData): void => {
    forgotPassword(data.email);
  };

  return (
    <div className="mx-auto w-full max-w-sm space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Forgot your password?</h1>
        <p className="text-sm text-muted-foreground">
          Enter your email and we&apos;ll send you a link to reset it
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? 'email-error' : undefined}
            {...register('email')}
            className={cn(errors.email && 'border-destructive')}
          />
          {errors.email && (
            <p id="email-error" className="text-sm text-destructive">{errors.email.message}</p>
          )}
        </div>

        {/* Rate limit or email cap, with the wait time (no toast for these). */}
        <LimitNotice error={error} />

        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Sending...
            </>
          ) : (
            'Send reset link'
          )}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Remembered it?{' '}
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
