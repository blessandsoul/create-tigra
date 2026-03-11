> **SCOPE**: These rules apply specifically to the **client** directory (Next.js App Router).

# Components & Types

## Component Rules

- **Server Components by default.** Only add `'use client'` for hooks, state, or event handlers.
- **Max 250 lines** per component. Split if exceeded.
- **Max 5 props.** Group related props into an object if more are needed.
- **Max 3 levels** of JSX nesting. Extract sub-components if deeper.
- **Internal ordering**: hooks → event handlers → effects → early returns → render.
- **Handler naming**: `handle<Event>` for internal handlers, `on<Event>` for callback props.
- **Wrap handlers in `useCallback`** when passed to child components (Client Components only).
- **Use `useMemo`** for expensive computations in Client Components.

### Anti-patterns

- Do NOT add `'use client'` to components that have no interactivity — keep them as Server Components.
- Do NOT fetch data in Client Components when a Server Component can fetch it and pass as props.
- Do NOT use inline styles. Use Tailwind + `cn()` for conditional classes.

---

## TypeScript Rules

- **Strict mode ON.** No `any` — use `unknown` if the type is truly unknown.
- **Explicit return types** on all functions.
- **`interface`** for component props and object shapes. **`type`** for unions, intersections, utilities.
- **Prefer string unions** over enums: `type UserRole = 'USER' | 'ADMIN'`
- **Infer form types from Zod**: `type FormData = z.infer<typeof formSchema>`
- **Always use `import type`** for type-only imports.

---

## API Response Types

```typescript
// lib/api/api.types.ts

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
}

export interface PaginatedApiResponse<T> {
  success: boolean;
  message: string;
  data: {
    items: T[];
    pagination: {
      page: number;
      limit: number;
      totalItems: number;
      totalPages: number;
      hasNextPage: boolean;
      hasPreviousPage: boolean;
    };
  };
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

export interface PaginationParams {
  page?: number;
  limit?: number;
}
```

---

## Domain Types

```typescript
// features/auth/types/auth.types.ts

export interface IUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  isActive: boolean;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export type UserRole = 'USER' | 'ADMIN';

export interface ILoginRequest {
  email: string;
  password: string;
}

export interface IRegisterRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

// No IAuthTokens — tokens are stored in httpOnly cookies, never exposed to JS.

export interface IAuthState {
  user: IUser | null;
  isAuthenticated: boolean;
  isInitializing: boolean;  // true until first getMe() resolves
  isLoggingOut: boolean;     // true during logout API call
}
```

```typescript
// features/<domain>/types/<domain>.types.ts — example pattern

export interface Item {
  id: string;
  ownerId: string;
  title: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateItemRequest {
  title: string;
  description?: string;
}

export interface UpdateItemRequest {
  title?: string;
  description?: string;
}

export interface ItemFilters {
  search?: string;
  sortBy?: 'createdAt' | 'title';
}
```
