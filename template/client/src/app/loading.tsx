import type React from 'react';

import { LoadingSpinner } from '@/components/common/LoadingSpinner';

export default function Loading(): React.ReactElement {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <LoadingSpinner size="lg" />
    </div>
  );
}
