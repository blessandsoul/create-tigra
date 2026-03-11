'use client';

import type React from 'react';

import Image from 'next/image';
import type { ImageProps } from 'next/image';

/**
 * Wraps Next.js <Image> to bypass the optimization proxy for localhost URLs.
 *
 * Next.js refuses to fetch images from loopback IPs (127.0.0.1, ::1) through
 * its optimization proxy — even when remotePatterns allows localhost. This is
 * a security restriction to prevent SSRF attacks.
 *
 * SafeImage detects localhost/loopback URLs and sets `unoptimized` so the
 * image loads directly via a regular <img> tag. In production with a real
 * domain, images are optimized normally.
 */

const LOOPBACK_PATTERNS = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '[::1]',
] as const;

function isLoopbackUrl(src: ImageProps['src']): boolean {
  if (typeof src !== 'string') return false;

  try {
    const url = new URL(src);
    return LOOPBACK_PATTERNS.some((pattern) => url.hostname === pattern);
  } catch {
    // Relative path or invalid URL — not a loopback issue
    return false;
  }
}

export const SafeImage = (props: ImageProps): React.ReactElement => {
  const shouldSkipOptimization = isLoopbackUrl(props.src);

  return (
    <Image
      {...props}
      unoptimized={props.unoptimized || shouldSkipOptimization}
    />
  );
};
