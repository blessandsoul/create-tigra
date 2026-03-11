'use client';

import type React from 'react';
import { AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactElement {
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center p-8 text-center">
      <AlertCircle className="mb-4 h-12 w-12 text-destructive" />
      <h2 className="mb-2 text-2xl font-bold">Something went wrong</h2>
      <p className="mb-4 text-muted-foreground">
        {process.env.NODE_ENV === 'development'
          ? error.message
          : 'An unexpected error occurred. Please try again.'}
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
