import { headers } from 'next/headers';
import type { Metadata, Viewport } from 'next';
import type React from 'react';
import { Inter, JetBrains_Mono } from 'next/font/google';

import { Providers } from './providers';
import { APP_NAME } from '@/lib/constants/app.constants';
import './globals.css';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
});

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: APP_NAME,
  description: 'A full-stack application built with Next.js and Fastify',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): Promise<React.ReactElement> {
  // Read the per-request nonce set by middleware. next-themes injects an inline
  // anti-FOUC <script> via dangerouslySetInnerHTML that Next does NOT auto-nonce,
  // so under our 'strict-dynamic' CSP it must be passed the nonce explicitly or
  // the browser refuses it (causing a flash / hydration mismatch).
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        <Providers nonce={nonce}>{children}</Providers>
      </body>
    </html>
  );
}
