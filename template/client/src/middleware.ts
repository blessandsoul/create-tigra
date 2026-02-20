import { NextResponse } from 'next/server';

import type { NextRequest } from 'next/server';

const protectedPaths = ['/', '/dashboard', '/profile', '/admin'];
const authPaths = ['/login', '/register'];

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
  const token = request.cookies.get('access_token')?.value;

  const isProtectedPath = protectedPaths.some((path) =>
    path === '/' ? pathname === '/' : pathname.startsWith(path)
  );

  if (isProtectedPath && (!token || isTokenExpired(token))) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  const isAuthPath = authPaths.some((path) => pathname.startsWith(path));

  if (isAuthPath && token) {
    if (isTokenExpired(token)) {
      // Only delete the expired access token — keep the refresh token
      // so the client-side interceptor can still recover the session
      const response = NextResponse.next();
      response.cookies.delete('access_token');
      return response;
    }
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/',
    '/dashboard/:path*',
    '/profile/:path*',
    '/admin/:path*',
    '/login',
    '/register',
  ],
};
