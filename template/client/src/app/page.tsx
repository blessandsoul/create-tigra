import type React from 'react';
import type { Metadata } from 'next';

import Image from 'next/image';

import { APP_NAME } from '@/lib/constants/app.constants';

export const metadata: Metadata = {
  title: APP_NAME,
  description: `Welcome to ${APP_NAME} — generated with create-tigra`,
};

export default function WelcomePage(): React.ReactElement {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6">
      {/* Ambient glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
      >
        <div className="motion-safe:animate-pulse h-64 w-64 rounded-full bg-primary/15 blur-3xl md:h-96 md:w-96" />
      </div>

      {/* Content */}
      <div className="relative z-10 flex max-w-md flex-col items-center text-center">
        {/* Logo */}
        <div className="mb-8">
          <Image
            src="/logo.png"
            alt={`${APP_NAME} logo`}
            width={160}
            height={160}
            priority
            className="h-32 w-32 md:h-40 md:w-40"
          />
        </div>

        <h1 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">
          {APP_NAME}
        </h1>

        <p className="mt-3 text-base text-muted-foreground md:text-lg">
          Generated with{' '}
          <span className="font-semibold text-foreground">create-tigra</span>
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:gap-4">
          <a
            href="https://github.com/BehzodKarimov/create-tigra"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-all duration-200 active:scale-[0.97] md:hover:brightness-110"
          >
            Documentation
          </a>
          <a
            href="https://github.com/BehzodKarimov/create-tigra/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-secondary px-5 py-2.5 text-sm font-medium text-secondary-foreground transition-all duration-200 active:scale-[0.97] md:hover:bg-accent"
          >
            Report an issue
          </a>
        </div>

        <p className="mt-12 font-mono text-xs text-muted-foreground md:text-sm">
          Edit{' '}
          <code className="rounded-md bg-muted px-1.5 py-0.5">
            src/app/page.tsx
          </code>{' '}
          to get started
        </p>
      </div>
    </div>
  );
}
