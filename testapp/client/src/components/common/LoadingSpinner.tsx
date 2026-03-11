import type React from 'react';
import { Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';

type SpinnerSize = 'sm' | 'md' | 'lg';

const sizeClasses: Record<SpinnerSize, string> = {
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-8 w-8',
};

interface LoadingSpinnerProps {
  size?: SpinnerSize;
  className?: string;
}

export const LoadingSpinner = ({
  size = 'md',
  className,
}: LoadingSpinnerProps): React.ReactElement => {
  return (
    <Loader2
      role="status"
      className={cn('motion-safe:animate-spin text-muted-foreground', sizeClasses[size], className)}
      aria-label="Loading"
    />
  );
};
