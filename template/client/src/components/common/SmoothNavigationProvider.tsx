'use client';

import type React from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { usePathname, useSearchParams } from 'next/navigation';

import { RouteLoadingShell } from './RouteLoadingShell';

const MAX_SMOOTH_SCROLL_MS = 1500;
const NAVIGATION_FAILSAFE_MS = 30_000;

interface SmoothNavigationContextValue {
  startNavigation: (destination: string) => void;
}

const SmoothNavigationContext = createContext<SmoothNavigationContextValue | null>(null);

interface SmoothNavigationProviderProps {
  children: React.ReactNode;
}

export const SmoothNavigationProvider = ({
  children,
}: SmoothNavigationProviderProps): React.ReactElement => {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isNavigating, setIsNavigating] = useState(false);
  const animationFrameRef = useRef<number | null>(null);
  const destinationRef = useRef<string | null>(null);
  const originRef = useRef<string | null>(null);
  const navigationTimeoutRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const clearTransitionState = useCallback((): void => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    const root = document.documentElement;
    delete root.dataset.smoothNavigation;
    root.style.removeProperty('--smooth-navigation-min-height');
  }, []);

  const finishNavigation = useCallback((): void => {
    if (navigationTimeoutRef.current !== null) {
      window.clearTimeout(navigationTimeoutRef.current);
      navigationTimeoutRef.current = null;
    }
    destinationRef.current = null;
    originRef.current = null;
    setIsNavigating(false);
  }, []);

  const cancelNavigation = useCallback((): void => {
    finishNavigation();
    clearTransitionState();
  }, [clearTransitionState, finishNavigation]);

  const startNavigation = useCallback((destination: string): void => {
    clearTransitionState();

    const root = document.documentElement;
    const documentHeight = Math.max(root.scrollHeight, document.body.scrollHeight, root.clientHeight);

    // The route fallback can be shorter than the outgoing page. Preserve its
    // height until scrolling reaches the top so the browser cannot clamp the
    // scroll position and turn a smooth transition into an instant jump.
    root.dataset.smoothNavigation = 'pending';
    root.style.setProperty('--smooth-navigation-min-height', `${documentHeight}px`);

    window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });

    const startedAt = window.performance.now();
    const monitorScroll = (): void => {
      const timedOut = window.performance.now() - startedAt >= MAX_SMOOTH_SCROLL_MS;
      if (Math.abs(window.scrollY) <= 1 || timedOut) {
        clearTransitionState();
        return;
      }
      animationFrameRef.current = window.requestAnimationFrame(monitorScroll);
    };

    animationFrameRef.current = window.requestAnimationFrame(monitorScroll);
    timeoutRef.current = window.setTimeout(clearTransitionState, MAX_SMOOTH_SCROLL_MS + 100);

    const destinationUrl = new URL(destination, window.location.href);
    const destinationKey = `${destinationUrl.pathname}${destinationUrl.search}`;
    const currentKey = `${window.location.pathname}${window.location.search}`;
    if (destinationKey === currentKey) {
      return;
    }

    destinationRef.current = destinationKey;
    originRef.current = currentKey;
    setIsNavigating(true);
    if (navigationTimeoutRef.current !== null) {
      window.clearTimeout(navigationTimeoutRef.current);
    }
    navigationTimeoutRef.current = window.setTimeout(cancelNavigation, NAVIGATION_FAILSAFE_MS);
  }, [cancelNavigation, clearTransitionState]);

  useEffect(() => {
    const currentKey = `${pathname}${searchParams.size > 0 ? `?${searchParams.toString()}` : ''}`;
    if (
      destinationRef.current === currentKey ||
      (originRef.current !== null && originRef.current !== currentKey)
    ) {
      // The new route can commit before the smooth scroll reaches the top.
      // Hide the overlay without releasing the preserved document height. A
      // changed key also handles redirects whose URL differs from the request.
      finishNavigation();
    }
  }, [finishNavigation, pathname, searchParams]);

  useEffect(
    () => () => {
      if (navigationTimeoutRef.current !== null) {
        window.clearTimeout(navigationTimeoutRef.current);
      }
      clearTransitionState();
    },
    [clearTransitionState]
  );

  const value = useMemo(() => ({ startNavigation }), [startNavigation]);

  return (
    <SmoothNavigationContext.Provider value={value}>
      {children}
      {isNavigating && (
        <div className="fixed inset-0 z-40 overflow-hidden bg-background" aria-busy="true">
          <RouteLoadingShell className="min-h-dvh" />
        </div>
      )}
    </SmoothNavigationContext.Provider>
  );
};

export const useSmoothNavigation = (): SmoothNavigationContextValue => {
  const context = useContext(SmoothNavigationContext);
  if (!context) {
    throw new Error('useSmoothNavigation must be used within SmoothNavigationProvider');
  }
  return context;
};
