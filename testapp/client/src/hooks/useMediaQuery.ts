'use client';

import { useCallback, useSyncExternalStore } from 'react';

export const useMediaQuery = (query: string): boolean => {
  const subscribe = useCallback(
    (callback: () => void): (() => void) => {
      const media = window.matchMedia(query);
      media.addEventListener('change', callback);
      return () => media.removeEventListener('change', callback);
    },
    [query],
  );

  const getSnapshot = (): boolean => {
    return window.matchMedia(query).matches;
  };

  const getServerSnapshot = (): boolean => {
    return false;
  };

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
};

export const useIsMobile = (): boolean => useMediaQuery('(max-width: 768px)');
export const useIsTablet = (): boolean => useMediaQuery('(max-width: 1024px)');
