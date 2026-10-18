'use client';

import type React from 'react';

import { getLimitInfo } from '@/lib/utils/error';

/**
 * Inline "slow down" message for the auth forms: a rate limit, a login lock or
 * the per-address email cap, with the wait time from the server. Renders
 * nothing for any other error (those keep their toast). The form's request is
 * sent with `skipLimitToast`, so this is the only place the message appears.
 *
 * Building your own login, register or forgot-password screen on useAuth /
 * useForgotPassword? Render this with their error (loginError, registerError,
 * error): for those calls nothing else tells the user to wait.
 */
export const LimitNotice = ({ error }: { error: unknown }): React.ReactElement | null => {
  const limit = getLimitInfo(error);
  if (!limit) return null;
  return (
    <p
      role="alert"
      className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
    >
      {limit.message}
    </p>
  );
};
