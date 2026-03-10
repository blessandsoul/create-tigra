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

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const accessToken = request.cookies.get('access_token')?.value;
  const authSession = request.cookies.get('auth_session')?.value;

  const isProtectedPath = protectedPaths.some((path) => pathname.startsWith(path));

  if (isProtectedPath) {
    // No access_token AND no auth_session — truly unauthenticated
    if (!accessToken && !authSession) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('from', pathname);
      return NextResponse.redirect(loginUrl);
    }

    // No access_token BUT auth_session exists — session is alive,
    // let through so client-side can do getMe() → 401 → refresh → retry
    if (!accessToken && authSession) {
      return NextResponse.next();
    }

    // Expired access_token — delete stale cookie, let through for client-side refresh
    if (accessToken && isTokenExpired(accessToken)) {
      const response = NextResponse.next();
      response.cookies.delete('access_token');
      return response;
    }

    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/profile/:path*',
    '/admin/:path*',
  ],
};
