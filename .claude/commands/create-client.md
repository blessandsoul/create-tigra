# Create Client Project

You are scaffolding a new Next.js App Router + TypeScript client project. The project name is: **$ARGUMENTS**

If no project name is provided, ask the user for one before proceeding.

---

## Instructions

Create a complete, production-ready Next.js client project following the architecture and rules defined in `.claude/rules/client/`. Read those rules before generating any code.

### Step 1: Create Next.js Project

Run:
```bash
npx create-next-app@latest $ARGUMENTS --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --no-turbopack
```

Then install additional dependencies:
```bash
# State & Data
npm install @reduxjs/toolkit react-redux @tanstack/react-query axios

# Dev tools
npm install -D @tanstack/react-query-devtools

# Forms & Validation
npm install react-hook-form @hookform/resolvers zod

# UI
npm install sonner next-themes lucide-react class-variance-authority clsx tailwind-merge tailwindcss-animate

# Init shadcn/ui
npx shadcn@latest init --defaults
```

Then install core shadcn components:
```bash
npx shadcn@latest add button card input label skeleton alert-dialog select table badge
```

---

### Step 2: Project Structure

Create the following directory structure under `src/`:

```
src/
├── app/
│   ├── layout.tsx              # Root layout
│   ├── page.tsx                # Home page
│   ├── providers.tsx           # Client providers (Redux, React Query, Theme)
│   ├── globals.css             # Global styles with CSS variables
│   ├── loading.tsx             # Global loading
│   ├── error.tsx               # Global error boundary
│   ├── not-found.tsx           # 404 page
│   ├── (auth)/
│   │   ├── layout.tsx          # Auth layout (centered, minimal)
│   │   ├── login/
│   │   │   └── page.tsx        # Login page
│   │   └── register/
│   │       └── page.tsx        # Register page
│   └── (main)/
│       ├── layout.tsx          # Main layout with Header/Footer
│       └── dashboard/
│           └── page.tsx        # Dashboard page (protected)
├── components/
│   ├── ui/                     # shadcn/ui components (auto-generated)
│   ├── layout/
│   │   ├── Header.tsx
│   │   ├── Footer.tsx
│   │   └── MainLayout.tsx
│   └── common/
│       ├── LoadingSpinner.tsx
│       ├── EmptyState.tsx
│       ├── Pagination.tsx
│       └── ConfirmDialog.tsx
├── features/
│   └── auth/
│       ├── components/
│       │   ├── LoginForm.tsx
│       │   └── RegisterForm.tsx
│       ├── hooks/
│       │   └── useAuth.ts
│       ├── services/
│       │   └── auth.service.ts
│       ├── store/
│       │   └── authSlice.ts
│       └── types/
│           └── auth.types.ts
├── hooks/
│   ├── useDebounce.ts
│   ├── useLocalStorage.ts
│   └── useMediaQuery.ts
├── lib/
│   ├── api/
│   │   ├── axios.config.ts
│   │   └── api.types.ts
│   ├── constants/
│   │   ├── routes.ts
│   │   ├── api-endpoints.ts
│   │   └── app.constants.ts
│   ├── utils/
│   │   ├── format.ts
│   │   ├── error.ts
│   │   └── security.ts
│   └── utils.ts                # cn() helper
├── store/
│   ├── index.ts
│   └── hooks.ts
├── types/
│   └── index.ts
└── middleware.ts
```

---

### Step 3: Configuration Files

#### `tailwind.config.ts`
Set up the full Tailwind config as specified in `04-design-system.md`:
- darkMode: "class"
- Content paths include src/features/**
- Extend colors with ALL semantic tokens: primary, secondary, destructive, muted, accent, popover, card, border, input, ring, brand (primary, secondary, accent), success, warning, info
- Container config: centered, 2rem padding, 1400px max
- Include tailwindcss-animate plugin

#### `src/app/globals.css`
Implement the FULL CSS variable system from `04-design-system.md`:
- `:root` with ALL light mode variables (background, foreground, primary, secondary, muted, accent, destructive, popover, card, border, input, ring, radius, brand colors, semantic colors: success, warning, info)
- `.dark` with ALL dark mode variables
- Base layer: `border-border` on all elements, `bg-background text-foreground` on body

#### `next.config.ts`
- Add security headers from `05-security.md`: X-Frame-Options, X-Content-Type-Options, Referrer-Policy, X-XSS-Protection
- Configure images.remotePatterns if needed

#### `.env.example` and `.env.local`
```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000/api/v1
NEXT_PUBLIC_APP_NAME=$ARGUMENTS
```

---

### Step 4: Core Library Files

#### `src/lib/utils.ts`
```typescript
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

#### `src/lib/api/api.types.ts`
Define ALL API response types from `02-components-and-types.md`:
- `ApiResponse<T>` — `{ success: true, message: string, data: T }`
- `PaginatedApiResponse<T>` — with items array and pagination object (page, limit, totalItems, totalPages, hasNextPage, hasPreviousPage)
- `ApiError` — `{ success: false, error: { code: string, message: string } }`
- `PaginationParams` — `{ page?: number, limit?: number }`

#### `src/lib/api/axios.config.ts`
Implement the FULL Axios config from `03-data-and-state.md`:
- Base URL from env
- Request interceptor: attach Bearer token from Redux store (client-side only with `typeof window` check)
- Response interceptor: handle 401 with token refresh flow, dispatch logout on failure, redirect to `/login`
- 30s timeout

#### `src/lib/constants/api-endpoints.ts`
```typescript
export const API_ENDPOINTS = {
  AUTH: {
    REGISTER: '/auth/register',
    LOGIN: '/auth/login',
    LOGOUT: '/auth/logout',
    REFRESH: '/auth/refresh',
    ME: '/auth/me',
    VERIFY_EMAIL: '/auth/verify-email',
    RESEND_VERIFICATION: '/auth/resend-verification',
    REQUEST_PASSWORD_RESET: '/auth/request-password-reset',
    RESET_PASSWORD: '/auth/reset-password',
  },
  USERS: {
    ME: '/users/me',
    UPDATE_ME: '/users/me',
    DELETE_ME: '/users/me',
  },
} as const;
```

#### `src/lib/constants/routes.ts`
```typescript
export const ROUTES = {
  HOME: '/',
  LOGIN: '/login',
  REGISTER: '/register',
  VERIFY_EMAIL: '/verify-email',
  RESET_PASSWORD: '/reset-password',
  DASHBOARD: '/dashboard',
  PROFILE: '/profile',
} as const;
```

#### `src/lib/constants/app.constants.ts`
```typescript
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || '$ARGUMENTS';

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 10,
  MAX_LIMIT: 100,
} as const;

export const USER_ROLES = {
  USER: 'USER',
  COMPANY: 'COMPANY',
  ADMIN: 'ADMIN',
  GUIDE: 'GUIDE',
  DRIVER: 'DRIVER',
} as const;
```

#### `src/lib/utils/error.ts`
Implement the error utility from `03-data-and-state.md`:
```typescript
import axios from 'axios';
import type { ApiError } from '@/lib/api/api.types';

export const getErrorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const apiError = error.response?.data as ApiError;
    if (apiError?.error?.message) {
      return apiError.error.message;
    }
    if (error.code === 'ERR_NETWORK') {
      return 'Network error. Check your connection.';
    }
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'An unexpected error occurred';
};

export const getErrorCode = (error: unknown): string | undefined => {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.error?.code;
  }
  return undefined;
};

export const isErrorCode = (error: unknown, code: string): boolean => {
  return getErrorCode(error) === code;
};
```

#### `src/lib/utils/format.ts`
```typescript
export const formatCurrency = (amount: number, currency = 'GEL'): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
};

export const formatDate = (date: string | Date): string => {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(date));
};

export const formatRelativeTime = (date: string | Date): string => {
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const now = new Date();
  const then = new Date(date);
  const diffInSeconds = (then.getTime() - now.getTime()) / 1000;

  const units: { unit: Intl.RelativeTimeFormatUnit; seconds: number }[] = [
    { unit: 'year', seconds: 31536000 },
    { unit: 'month', seconds: 2592000 },
    { unit: 'day', seconds: 86400 },
    { unit: 'hour', seconds: 3600 },
    { unit: 'minute', seconds: 60 },
  ];

  for (const { unit, seconds } of units) {
    if (Math.abs(diffInSeconds) >= seconds) {
      return rtf.format(Math.round(diffInSeconds / seconds), unit);
    }
  }
  return rtf.format(Math.round(diffInSeconds), 'second');
};

export const truncate = (str: string, length: number): string => {
  return str.length > length ? `${str.substring(0, length)}...` : str;
};
```

#### `src/lib/utils/security.ts`
Implement from `05-security.md`:
```typescript
export const isSafeUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol);
  } catch {
    return false;
  }
};

export const sanitizeString = (input: string): string => {
  return input.trim().replace(/[<>]/g, '').slice(0, 1000);
};

export const sanitizeEmail = (email: string): string => {
  return email.toLowerCase().trim().slice(0, 255);
};

export const maskEmail = (email: string): string => {
  const [local, domain] = email.split('@');
  if (!local || !domain) return email;
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
};
```

---

### Step 5: State Management

#### `src/store/index.ts`
Redux store setup from `03-data-and-state.md`:
- Configure store with auth reducer
- Load auth state from localStorage (with SSR guard: `typeof window !== 'undefined'`)
- Subscribe to save auth state to localStorage (with SSR guard)
- Export `RootState` and `AppDispatch` types

#### `src/store/hooks.ts`
Typed Redux hooks:
```typescript
import { TypedUseSelectorHook, useDispatch, useSelector } from 'react-redux';
import type { RootState, AppDispatch } from './index';

export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
```

#### `src/features/auth/store/authSlice.ts`
Auth slice from `03-data-and-state.md`:
- State: `{ user: IUser | null, tokens: IAuthTokens | null, isAuthenticated: boolean }`
- Reducers: `setCredentials`, `updateTokens`, `logout`

#### `src/features/auth/types/auth.types.ts`
Auth types from `02-components-and-types.md`:
- `IUser` interface
- `UserRole` type (`'USER' | 'COMPANY' | 'ADMIN' | 'GUIDE' | 'DRIVER'`)
- `IAuthTokens` interface
- `ILoginRequest`, `IRegisterRequest` interfaces
- `IAuthState` interface

#### `src/features/auth/services/auth.service.ts`
Auth service class from `03-data-and-state.md`:
- `register`, `login`, `logout`, `refreshToken`, `getMe`, `verifyEmail`, `requestPasswordReset`, `resetPassword`
- Uses `apiClient` and `API_ENDPOINTS`
- Singleton export: `export const authService = new AuthService();`

#### `src/features/auth/hooks/useAuth.ts`
```typescript
'use client';

import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { useMutation } from '@tanstack/react-query';
import { authService } from '../services/auth.service';
import { setCredentials, logout as logoutAction } from '../store/authSlice';
import { useRouter } from 'next/navigation';

export const useAuth = () => {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const { user, isAuthenticated, tokens } = useAppSelector((state) => state.auth);

  const loginMutation = useMutation({
    mutationFn: authService.login,
    onSuccess: (data) => {
      dispatch(setCredentials(data));
      router.push('/dashboard');
    },
  });

  const logout = async (): Promise<void> => {
    try {
      await authService.logout();
    } finally {
      dispatch(logoutAction());
      if (typeof window !== 'undefined') {
        localStorage.removeItem('auth');
        sessionStorage.clear();
      }
      router.push('/login');
    }
  };

  return {
    user,
    isAuthenticated,
    login: loginMutation.mutate,
    logout,
    isLoggingIn: loginMutation.isPending,
  };
};
```

---

### Step 6: Providers & Layout

#### `src/app/providers.tsx`
```typescript
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { Provider as ReduxProvider } from 'react-redux';
import { ThemeProvider } from 'next-themes';
import { Toaster } from 'sonner';
import { useState } from 'react';
import { store } from '@/store';

export function Providers({ children }: { children: React.ReactNode }): React.ReactElement {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000,
            gcTime: 10 * 60 * 1000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );

  return (
    <ReduxProvider store={store}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
          <Toaster position="top-right" richColors />
        </ThemeProvider>
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </ReduxProvider>
  );
}
```

#### `src/app/layout.tsx`
Root layout:
- Import and use `next/font` (Inter or Geist Sans)
- `<html lang="en" suppressHydrationWarning>`
- Wrap children in `<Providers>`
- Default metadata with app name

#### `src/app/(main)/layout.tsx`
Main layout with Header and Footer wrapping children in a flex column min-h-screen structure.

#### `src/app/(auth)/layout.tsx`
Auth layout: centered, minimal — flex items-center justify-center min-h-screen.

---

### Step 7: Common Components

#### `src/components/layout/Header.tsx`
Client component with:
- App name / logo link to home
- Navigation links
- Auth-aware: show Login/Register or user menu based on auth state
- Theme toggle button (Sun/Moon icons with `next-themes` `useTheme`)
- Responsive (mobile menu)

#### `src/components/layout/Footer.tsx`
Server component, simple footer with copyright.

#### `src/components/common/LoadingSpinner.tsx`
Using Lucide `Loader2` icon with spin animation. Accept `size` prop.

#### `src/components/common/EmptyState.tsx`
```typescript
import { FileQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

interface EmptyStateProps {
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
}

export const EmptyState = ({
  title,
  description,
  actionLabel,
  actionHref,
}: EmptyStateProps): React.ReactElement => (
  <div className="flex min-h-[400px] flex-col items-center justify-center p-8 text-center">
    <FileQuestion className="mb-4 h-16 w-16 text-muted-foreground" />
    <h3 className="mb-2 text-xl font-semibold">{title}</h3>
    <p className="mb-4 text-muted-foreground">{description}</p>
    {actionLabel && actionHref && (
      <Button asChild>
        <Link href={actionHref}>{actionLabel}</Link>
      </Button>
    )}
  </div>
);
```

#### `src/components/common/Pagination.tsx`
```typescript
'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback } from 'react';

interface PaginationProps {
  page: number;
  totalPages: number;
}

export const Pagination = ({ page, totalPages }: PaginationProps): React.ReactElement => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const createPageUrl = useCallback(
    (pageNumber: number): string => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('page', pageNumber.toString());
      return `${pathname}?${params.toString()}`;
    },
    [pathname, searchParams]
  );

  return (
    <div className="flex items-center justify-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => router.push(createPageUrl(page - 1))}
        disabled={page <= 1}
        aria-label="Previous page"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="text-sm text-muted-foreground">
        Page {page} of {totalPages}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => router.push(createPageUrl(page + 1))}
        disabled={page >= totalPages}
        aria-label="Next page"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
};
```

#### `src/components/common/ConfirmDialog.tsx`
```typescript
'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  isDestructive?: boolean;
}

export const ConfirmDialog = ({
  open,
  onOpenChange,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  isDestructive = false,
}: ConfirmDialogProps): React.ReactElement => (
  <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction
          onClick={onConfirm}
          className={isDestructive ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}
        >
          {confirmLabel}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
```

---

### Step 8: Global Custom Hooks

#### `src/hooks/useDebounce.ts`
```typescript
'use client';

import { useState, useEffect } from 'react';

export const useDebounce = <T,>(value: T, delay = 500): T => {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
};
```

#### `src/hooks/useLocalStorage.ts`
```typescript
'use client';

import { useState, useEffect } from 'react';

export const useLocalStorage = <T,>(key: string, initialValue: T) => {
  const [storedValue, setStoredValue] = useState<T>(initialValue);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    try {
      const item = window.localStorage.getItem(key);
      if (item) {
        setStoredValue(JSON.parse(item));
      }
    } catch {
      // Ignore errors
    }
    setIsHydrated(true);
  }, [key]);

  const setValue = (value: T | ((val: T) => T)): void => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      window.localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch {
      // Ignore write errors
    }
  };

  return [storedValue, setValue, isHydrated] as const;
};
```

#### `src/hooks/useMediaQuery.ts`
```typescript
'use client';

import { useState, useEffect } from 'react';

export const useMediaQuery = (query: string): boolean => {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    setMatches(media.matches);

    const listener = (e: MediaQueryListEvent): void => setMatches(e.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [query]);

  return matches;
};

export const useIsMobile = (): boolean => useMediaQuery('(max-width: 768px)');
export const useIsTablet = (): boolean => useMediaQuery('(max-width: 1024px)');
```

---

### Step 9: Auth Pages

#### `src/app/(auth)/login/page.tsx`
Server component page that renders `LoginForm`.

#### `src/app/(auth)/register/page.tsx`
Server component page that renders `RegisterForm`.

#### `src/features/auth/components/LoginForm.tsx`
Client component:
- React Hook Form + Zod validation (email + password)
- Submit button with loading state ("Signing in..." / "Sign in")
- Link to register page
- Uses `useAuth` hook for login
- Field-level error messages below each field (red text + red border)

#### `src/features/auth/components/RegisterForm.tsx`
Client component:
- React Hook Form + Zod validation
- First name, last name, email, password, confirm password
- Password schema: min 8 chars, must contain uppercase, lowercase, and number
- Submit button with loading state
- Link to login page

---

### Step 10: Dashboard & Home Pages

#### `src/app/page.tsx`
Simple home page (Server Component). Welcome message with links to login/register or dashboard.

#### `src/app/(main)/dashboard/page.tsx`
Simple dashboard page placeholder (Server Component). Shows "Welcome to your dashboard."

#### `src/app/loading.tsx`
Global loading component with LoadingSpinner.

#### `src/app/error.tsx`
Client component global error boundary:
```typescript
'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { AlertCircle } from 'lucide-react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactElement {
  useEffect(() => {
    // Log to error reporting service in production
  }, [error]);

  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center p-8 text-center">
      <AlertCircle className="mb-4 h-12 w-12 text-destructive" />
      <h2 className="mb-2 text-2xl font-bold">Something went wrong</h2>
      <p className="mb-4 text-muted-foreground">{error.message}</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
```

#### `src/app/not-found.tsx`
Simple 404 page with link to home.

---

### Step 11: Middleware

#### `src/middleware.ts`

> **Note**: The current auth system stores tokens in Redux + localStorage. Next.js middleware runs on the Edge and cannot access localStorage. This middleware checks for an `accessToken` cookie. For full protection, the login flow should also set an httpOnly cookie via a Server Action or API route. As a fallback, this middleware provides basic route protection — full auth verification happens client-side via the axios interceptor.

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const protectedPaths = ['/dashboard', '/profile', '/my-tours', '/admin'];
const authPaths = ['/login', '/register'];

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get('accessToken')?.value;

  const isProtectedPath = protectedPaths.some((path) =>
    pathname.startsWith(path)
  );

  if (isProtectedPath && !token) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  const isAuthPath = authPaths.some((path) => pathname.startsWith(path));

  if (isAuthPath && token) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/profile/:path*',
    '/my-tours/:path*',
    '/admin/:path*',
    '/login',
    '/register',
  ],
};
```

---

### Step 12: Global Types

#### `src/types/index.ts`
Shared utility types:
```typescript
export type Nullable<T> = T | null;
export type Optional<T> = T | undefined;
export type AsyncResult<T> = Promise<T>;
```

---

### Step 13: Final Verification

After creating all files:
1. Run `npm run dev` to verify the project starts without errors
2. Check that the home page renders at `http://localhost:3001` (or the configured port)
3. Verify no TypeScript errors

---

## IMPORTANT RULES

- Follow ALL rules from `.claude/rules/client/` and `.claude/rules/global/`
- Server Components by default — only add `'use client'` when hooks/state/events are needed
- Max 250 lines per component, max 5 props, max 3 JSX nesting levels
- No hardcoded colors — use Tailwind semantic tokens only (`bg-primary`, `text-foreground`)
- No inline styles — Tailwind only with `cn()` for conditional classes
- Import order: React/Next → third-party → UI → local → hooks → services → types → utils
- Forms: validate with Zod client-side AND server-side
- Never prefix secrets with `NEXT_PUBLIC_`
- Use `next/image` for images, `next/link` for navigation
- Pair background with foreground colors (`bg-primary text-primary-foreground`)
- All interactive elements need hover/active/focus-visible states
