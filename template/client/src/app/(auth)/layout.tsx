import type React from 'react';

import { APP_NAME } from '@/lib/constants/app.constants';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <span className="mb-8 text-xl font-semibold tracking-tight text-foreground">
        {APP_NAME}
      </span>
      {children}
    </div>
  );
}
