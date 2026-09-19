import type React from 'react';

import { LoadingSpinner } from './LoadingSpinner';
import { cn } from '@/lib/utils';

/**
 * Shared fallback for route transitions that are waiting on server data.
 * Keep this intentionally generic so feature pages can later replace it with
 * a layout-matching skeleton without changing the navigation contract.
 */
interface RouteLoadingShellProps {
  className?: string;
}

export const RouteLoadingShell = ({ className }: RouteLoadingShellProps): React.ReactElement => {
  return (
    <div className={cn('flex min-h-[calc(100dvh-8rem)] items-center justify-center p-6', className)}>
      <LoadingSpinner size="lg" />
    </div>
  );
};
