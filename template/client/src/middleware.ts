import { NextResponse } from 'next/server';

import type { NextRequest } from 'next/server';

const protectedPaths = ['/dashboard', '/profile', '/admin'];

function isTokenExpired(token: string): boolean {
  try {
    const [, payload] = token.split('.');
    const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return !decoded.exp || decoded.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

/**
 * Derive the origin (scheme://host[:port]) of a URL, falling back to the input
 * when it can't be parsed. Used to turn NEXT_PUBLIC_API_BASE_URL (which may
 * carry a path like .../api/v1) and the Sentry DSN into bare CSP source values.
 */
function toOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

const apiOrigin = toOrigin(process.env.NEXT_PUBLIC_API_BASE_URL) ?? 'http://localhost:8000';
// When Sentry is configured, its browser SDK POSTs envelopes to the DSN origin;
// it must be allowed in connect-src or every error report is blocked by CSP.
const sentryOrigin = toOrigin(process.env.NEXT_PUBLIC_SENTRY_DSN);

/**
 * Build the per-request Content-Security-Policy. A fresh nonce is minted for
 * every request and threaded onto Next's own scripts (see middleware below), so
 * 'strict-dynamic' can trust them while refusing any attacker-injected inline
 * script that lacks the nonce.
 *
 * DEV relaxes script-src with 'unsafe-eval' (Next's HMR/react-refresh evals) and
 * style-src with 'unsafe-inline' (the dev overlay injects inline styles). PROD
 * is strict. Style-src keeps 'unsafe-inline' in PROD too: Tailwind v4 and some
 * libraries emit inline <style>/style="" that a nonce cannot cover and that a
 * strict style-src would REFUSE, breaking the page. Inline styles cannot
 * exfiltrate data the way inline scripts can, so this is an accepted tradeoff —
 * the high-value half (the strict, nonce-gated script-src) stays intact.
 */
function buildCsp(nonce: string, isProd: boolean): string {
  const connectSrc = ["'self'", apiOrigin, sentryOrigin].filter(Boolean).join(' ');

  const scriptSrc = isProd
    ? `'self' 'nonce-${nonce}' 'strict-dynamic' https:`
    : `'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval' https:`;

  // 'unsafe-inline' in style-src in BOTH modes (see note above).
  const styleSrc = `'self' 'unsafe-inline'`;

  return [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    `style-src ${styleSrc}`,
    `img-src 'self' blob: data: ${apiOrigin}`,
    `font-src 'self'`,
    `connect-src ${connectSrc}`,
    `object-src 'none'`,
    `base-uri 'none'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ].join('; ');
}

/**
 * Attach the static security headers shared by every response. HSTS is
 * deliberately NOT set here — it is managed at the Cloudflare edge.
 */
function applySecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Redundant with frame-ancestors 'none' but harmless for legacy browsers.
  response.headers.set('X-Frame-Options', 'DENY');
  return response;
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  const isProd = process.env.NODE_ENV === 'production';

  // --- Per-request nonce + CSP (canonical Next.js pattern) ---
  // base64-encoded random UUID. Minted fresh per request so 'strict-dynamic'
  // only trusts scripts we (and Next) emit this request.
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const cspHeader = buildCsp(nonce, isProd);

  // Propagate the nonce + CSP on the REQUEST headers. Next reads the CSP from
  // the request to extract the nonce and stamps it onto its own <script> tags;
  // without this, strict-dynamic would refuse Next's scripts and break the page.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', cspHeader);

  // NOTE: This middleware only checks COOKIE PRESENCE (and a best-effort,
  // unverified exp claim) for UX-level routing — redirecting users who are
  // obviously logged out away from protected pages. It does NOT verify the
  // JWT signature and is NOT a security boundary. Real authorization happens
  // server-side on every API call; a forged cookie gets past this middleware
  // but every API request it makes will be rejected with 401/403.
  const accessToken = request.cookies.get('access_token')?.value;
  const authSession = request.cookies.get('auth_session')?.value;

  const isProtectedPath = protectedPaths.some((path) => pathname.startsWith(path));

  if (isProtectedPath) {
    // No access_token AND no auth_session — truly unauthenticated.
    if (!accessToken && !authSession) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('from', pathname);
      const redirect = NextResponse.redirect(loginUrl);
      redirect.headers.set('content-security-policy', cspHeader);
      return applySecurityHeaders(redirect);
    }
  }

  // Single .next() response carrying the propagated request headers, the CSP
  // (also on the response, for the browser), and the static security headers.
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('content-security-policy', cspHeader);
  applySecurityHeaders(response);

  if (isProtectedPath) {
    // No access_token BUT auth_session exists — session is alive, let through
    // so client-side can do getMe() → 401 → refresh → retry.
    // (response already passes through; nothing extra needed here.)

    // Expired access_token — delete stale cookie, let through for client refresh.
    if (accessToken && isTokenExpired(accessToken)) {
      response.cookies.delete('access_token');
    }
  }

  return response;
}

export const config = {
  // Apply security headers site-wide, but skip Next's static assets and the
  // favicon (no CSP needed on immutable static files / images).
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
