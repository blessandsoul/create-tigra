'use client';

import { useCallback, useMemo } from 'react';

import { useRouter } from 'next/navigation';

import { useSmoothNavigation } from '@/components/common/SmoothNavigationProvider';

type AppRouter = ReturnType<typeof useRouter>;

/**
 * App Router wrapper that keeps Next.js from performing its instant scroll.
 * Pass `{ scroll: false }` explicitly when navigation should preserve position.
 */
export const useAppRouter = (): AppRouter => {
  const router = useRouter();
  const { startNavigation } = useSmoothNavigation();

  const push = useCallback<AppRouter['push']>(
    (href, options) => {
      if (options?.scroll !== false) {
        startNavigation(href);
      }
      router.push(href, { ...options, scroll: false });
    },
    [router, startNavigation]
  );

  const replace = useCallback<AppRouter['replace']>(
    (href, options) => {
      if (options?.scroll !== false) {
        startNavigation(href);
      }
      router.replace(href, { ...options, scroll: false });
    },
    [router, startNavigation]
  );

  return useMemo(() => ({ ...router, push, replace }), [router, push, replace]);
};
