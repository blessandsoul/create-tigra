'use client';

import type React from 'react';
import { forwardRef, useRef } from 'react';

import NextLink, { type LinkProps as NextLinkProps } from 'next/link';

import { useSmoothNavigation } from './SmoothNavigationProvider';

type AnchorProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof NextLinkProps>;

export type AppLinkProps = Omit<NextLinkProps, 'scroll'> & AnchorProps;

export const AppLink = forwardRef<HTMLAnchorElement, AppLinkProps>(
  ({ onClick, onNavigate, ...props }, ref): React.ReactElement => {
    const { startNavigation } = useSmoothNavigation();
    const pendingDestinationRef = useRef<string | null>(null);

    return (
      <NextLink
        {...props}
        ref={ref}
        scroll={false}
        onClick={(event) => {
          onClick?.(event);
          pendingDestinationRef.current = null;
          if (
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          ) {
            return;
          }

          const anchor = event.currentTarget;
          const destination = new URL(anchor.href);
          const current = new URL(window.location.href);
          const opensElsewhere = Boolean(anchor.target && anchor.target !== '_self');
          const isHashOnly =
            destination.pathname === current.pathname &&
            destination.search === current.search &&
            Boolean(destination.hash);

          if (
            opensElsewhere ||
            anchor.hasAttribute('download') ||
            destination.origin !== current.origin ||
            isHashOnly
          ) {
            return;
          }

          // onNavigate runs after onClick only for client-side navigations. Wait
          // for it so a consumer can still prevent navigation without briefly
          // showing a loader or starting the scroll animation.
          pendingDestinationRef.current = destination.href;
        }}
        onNavigate={(event) => {
          let navigationPrevented = false;
          onNavigate?.({
            preventDefault: () => {
              navigationPrevented = true;
              event.preventDefault();
            },
          });
          if (navigationPrevented) {
            pendingDestinationRef.current = null;
            return;
          }

          if (pendingDestinationRef.current) {
            startNavigation(pendingDestinationRef.current);
            pendingDestinationRef.current = null;
          }
        }}
      />
    );
  }
);

AppLink.displayName = 'AppLink';
