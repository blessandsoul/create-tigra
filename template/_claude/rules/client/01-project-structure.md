> **SCOPE**: These rules apply specifically to the **client** directory (Next.js App Router).

# Project Structure

## Folder Structure

```
src/
├── app/                    # Next.js App Router
│   ├── layout.tsx          # Root layout
│   ├── page.tsx            # Home page
│   ├── providers.tsx       # Client providers (Redux, React Query)
│   ├── globals.css         # Global styles
│   ├── (auth)/             # Auth route group
│   │   ├── login/page.tsx
│   │   ├── register/page.tsx
│   │   └── layout.tsx
│   ├── (main)/             # Main route group
│   │   ├── layout.tsx      # Header/Footer layout
│   │   └── <domain>/       # Domain-specific routes
│   ├── dashboard/          # Protected routes
│   └── admin/              # Admin routes
├── components/
│   ├── ui/                 # shadcn/ui components
│   ├── layout/             # Header, Footer, Sidebar, MainLayout
│   └── common/             # LoadingSpinner, ErrorBoundary, Pagination, EmptyState
├── features/               # Feature modules (domain-driven)
│   └── <domain>/
│       ├── components/
│       ├── hooks/
│       ├── services/       # <domain>.service.ts
│       ├── store/          # <domain>Slice.ts (if needed)
│       ├── types/          # <domain>.types.ts
│       └── actions/        # <domain>.actions.ts (Server Actions)
├── hooks/                  # Global hooks (useDebounce, useLocalStorage, useMediaQuery)
├── lib/
│   ├── api/                # axios.config.ts, api.types.ts
│   ├── constants/          # routes.ts, api-endpoints.ts, app.constants.ts
│   └── utils/              # format.ts, validation.ts, error.ts, cn() helper
├── store/                  # Redux store (index.ts, hooks.ts)
├── types/                  # Global types
└── middleware.ts            # Auth route protection
```

## File Naming

| Type | Pattern | Example |
|---|---|---|
| Component | `PascalCase.tsx` | `ProductCard.tsx` |
| Page | `folder/page.tsx` | `products/page.tsx` |
| Hook | `use<Name>.ts` | `useAuth.ts` |
| Service | `<domain>.service.ts` | `product.service.ts` |
| Types | `<domain>.types.ts` | `product.types.ts` |
| Redux slice | `<domain>Slice.ts` | `authSlice.ts` |
| Server Action | `<domain>.actions.ts` | `product.actions.ts` |
| Page exports | `default export` | Required by Next.js |
| Everything else | Named exports | `export const ProductCard` |

## Import Order

1. React / Next.js (`useState`, `useRouter`, `Image`, `Link`)
2. Third-party (`@tanstack/react-query`, `sonner`)
3. UI components (`@/components/ui/*`)
4. Local components
5. Hooks
6. Services
7. Types (always `import type`)
8. Utils (`cn`, `formatDate`)

## Constants

```typescript
// lib/constants/api-endpoints.ts
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
  // Add domain-specific endpoints following this pattern:
  // <DOMAIN>: {
  //   LIST: '/<domain>',
  //   CREATE: '/<domain>',
  //   GET: (id: string) => `/<domain>/${id}`,
  //   UPDATE: (id: string) => `/<domain>/${id}`,
  //   DELETE: (id: string) => `/<domain>/${id}`,
  // },
} as const;

// lib/constants/routes.ts
export const ROUTES = {
  HOME: '/',
  LOGIN: '/login',
  REGISTER: '/register',
  VERIFY_EMAIL: '/verify-email',
  RESET_PASSWORD: '/reset-password',
  DASHBOARD: '/dashboard',
  PROFILE: '/profile',
  // Add domain-specific routes following this pattern:
  // <DOMAIN>: {
  //   LIST: '/<domain>',
  //   DETAILS: (id: string) => `/<domain>/${id}`,
  //   CREATE: '/<domain>/create',
  //   EDIT: (id: string) => `/<domain>/${id}/edit`,
  // },
} as const;

// lib/constants/app.constants.ts
export const APP_NAME = 'My App';
export const PAGINATION = { DEFAULT_PAGE: 1, DEFAULT_LIMIT: 10, MAX_LIMIT: 100 } as const;
export const USER_ROLES = { USER: 'USER', ADMIN: 'ADMIN' } as const;
export const CURRENCIES = { USD: 'USD', EUR: 'EUR' } as const;
```

## App Providers

`app/providers.tsx` wraps the app with: **ReduxProvider** (store) → **QueryClientProvider** (React Query) → **Toaster** (sonner, position: top-right).

## Middleware

Protected paths: `/dashboard`, `/profile`, `/admin` — redirect to `/login` if no token.
Auth paths: `/login`, `/register` — redirect to `/dashboard` if already authenticated.
