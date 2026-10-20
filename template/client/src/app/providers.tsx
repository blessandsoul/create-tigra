'use client';

import type React from 'react';
import { useState } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Provider as ReduxProvider } from 'react-redux';
import { ThemeProvider } from 'next-themes';
import { Toaster } from 'sonner';

import { SmoothNavigationProvider } from '@/components/common/SmoothNavigationProvider';
import { makeStore } from '@/store';
import { AuthInitializer } from '@/features/auth/components/AuthInitializer';
import { ERROR_CODES, isErrorCode, isLimitError } from '@/lib/utils/error';

export function Providers({
  children,
  nonce,
  hasSession = false,
}: {
  children: React.ReactNode;
  // Per-request CSP nonce from the proxy (src/proxy.ts, via the root layout). Forwarded to
  // next-themes so its inline anti-FOUC script is allowed under 'strict-dynamic'.
  nonce?: string;
  // The request carried the session marker (read by the root layout): seeds the
  // store so the first render, on the server too, is right (store/index.ts).
  hasSession?: boolean;
}): React.ReactElement {
  // Made once per visitor, never shared between requests (store/index.ts).
  const [store] = useState(() => makeStore({ hasSession }));
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000,
            gcTime: 5 * 60 * 1000,
            refetchOnWindowFocus: true,
            refetchOnMount: true,
            // One retry for flaky networks, but never for a "slow down" answer
            // (429 / IP_BLOCKED): a retry would only earn another strike toward
            // the server's IP auto-block. Nor for wrong input (422
            // VALIDATION_FAILED): the same request fails the same way.
            // Mutations never retry (React Query default).
            retry: (failureCount, error) =>
              !isLimitError(error) && !isErrorCode(error, ERROR_CODES.VALIDATION_FAILED) && failureCount < 1,
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
          <SmoothNavigationProvider>
            <AuthInitializer>
              {children}
            </AuthInitializer>
          </SmoothNavigationProvider>
          <Toaster position="top-right" richColors />
        </ThemeProvider>
      </QueryClientProvider>
    </ReduxProvider>
  );
}
