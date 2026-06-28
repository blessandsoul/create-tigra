'use client';

import type React from 'react';
import { useState } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Provider as ReduxProvider } from 'react-redux';
import { ThemeProvider } from 'next-themes';
import { Toaster } from 'sonner';

import { store } from '@/store';
import { AuthInitializer } from '@/features/auth/components/AuthInitializer';

export function Providers({
  children,
  nonce,
}: {
  children: React.ReactNode;
  // Per-request CSP nonce from middleware (via the root layout). Forwarded to
  // next-themes so its inline anti-FOUC script is allowed under 'strict-dynamic'.
  nonce?: string;
}): React.ReactElement {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000,
            gcTime: 5 * 60 * 1000,
            refetchOnWindowFocus: true,
            refetchOnMount: true,
            retry: 1,
          },
        },
      })
  );

  return (
    <ReduxProvider store={store}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableColorScheme={false}
          nonce={nonce}
        >
          <AuthInitializer>
            {children}
          </AuthInitializer>
          <Toaster position="top-right" richColors />
        </ThemeProvider>
      </QueryClientProvider>
    </ReduxProvider>
  );
}
