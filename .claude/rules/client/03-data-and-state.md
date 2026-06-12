> **SCOPE**: These rules apply specifically to the **client** directory (Next.js App Router).

# Data, State & API Integration

## State Decision Matrix

| State Type | Tool | When |
|---|---|---|
| Server data (initial page load) | Server Components | SEO-critical, page-level data |
| Server data (client-triggered) | React Query | User actions, real-time updates, mutations |
| Global client state | Redux | Auth user + init/logout state — **nothing else** |
| Local UI state | `useState` / `useReducer` | Modals, hover, form inputs |
| URL-shareable state | `useSearchParams` | Filters, pagination, search query |

### Anti-patterns

- **No server state in Redux.** Use Server Components or React Query.
- **No UI state in Redux** (modals, loading). Use local state.
- **Prefer Server Component fetch** over client-side `useQuery` when the data is available at page level.

---

## React Query Config

Defaults in `app/providers.tsx`:

```typescript
staleTime: 30 * 1000         // 30s — short enough that back-navigation refetches
gcTime: 5 * 60 * 1000        // 5 min
refetchOnWindowFocus: true   // catch cross-tab edits
refetchOnMount: true         // always refetch stale data on mount
retry: 1
```

**Why these values matter**: With a long `staleTime` (e.g. 5 min) and `refetchOnWindowFocus: false`, navigating back to a list page after editing a record on another page will show stale data until the user hard-refreshes. Keep `staleTime` short and let invalidation + remount refetch do their job.

### Query Key Factory Pattern

```typescript
export const itemKeys = {
  all: ['items'] as const,
  lists: () => [...itemKeys.all, 'list'] as const,
  list: (filters: ItemFilters) => [...itemKeys.lists(), filters] as const,
  details: () => [...itemKeys.all, 'detail'] as const,
  detail: (id: string) => [...itemKeys.details(), id] as const,
};
```

### Mutations

On success:
1. **`queryClient.invalidateQueries({ queryKey: ... })`** — refreshes any client-fetched data (React Query).
2. **`router.refresh()`** — refreshes any Server-Component-rendered data on the next route the user navigates to. Without this, the Next.js Router Cache will serve stale RSC payloads on back-navigation, and your edit will not appear until a hard refresh.
3. Show a toast.
4. Navigate if needed.

On error: `toast.error(getErrorMessage(error))`.

**Always call both `invalidateQueries` AND `router.refresh()`** unless you are 100% certain no Server Component on any reachable route reads the mutated data. The two caches are independent — invalidating one does not touch the other.

```typescript
const router = useRouter();
const queryClient = useQueryClient();

const mutation = useMutation({
  mutationFn: (data) => itemService.updateItem(id, data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: itemKeys.all });
    router.refresh();
    toast.success('Item updated');
  },
  onError: (error) => toast.error(getErrorMessage(error)),
});
```

### Next.js Router Cache

`next.config.ts` sets `experimental.staleTimes: { dynamic: 0, static: 30 }` to minimize client-side Router Cache reuse. `static: 30` is the **Next 16.2+ minimum** — the config schema rejects values below 30, and an invalid value is silently ignored (re-enabling the default Router Cache). `dynamic: 0` is what protects data pages. **Never raise these values above these minimums** — doing so reintroduces the back-navigation stale-data bug across every page that uses Server Components for data fetching.

---

## Redux

**Scope**: Auth only. Single slice: `authSlice` with actions: `setUser`, `setInitialized`, `setLoggingOut`, `logout`.

Typed hooks in `store/hooks.ts`: `useAppDispatch`, `useAppSelector`.

State shape:
```typescript
{ user: IUser | null; isAuthenticated: boolean; isInitializing: boolean; isLoggingOut: boolean }
```

**Not persisted to localStorage** — auth state is hydrated by `AuthInitializer`, which calls the `useCurrentUser()` hook. `useCurrentUser()` is a React Query wrapper around `authService.getMe()` that syncs the result into Redux via a side effect. Tokens are stored in httpOnly cookies (not accessible from JS).

**Refreshing the current user**: any mutation that changes the logged-in user's own data (profile update, role change, avatar upload, email verification, subscription change, etc.) MUST invalidate the auth query so Redux picks up the new values:

```typescript
import { authKeys } from '@/features/auth/hooks/useCurrentUser';

queryClient.invalidateQueries({ queryKey: authKeys.me() });
```

Without this, Redux will hold the stale snapshot from initial page load until the next window-focus refetch (30s staleTime), or until logout/hard refresh. Never write directly to the auth slice from outside the auth feature — always go through invalidation.

---

## Axios Config

`lib/api/axios.config.ts` — singleton `apiClient`:

- **Base URL**: `process.env.NEXT_PUBLIC_API_BASE_URL` (fallback `http://localhost:8000/api/v1`)
- **Timeout**: 30s
- **`withCredentials: true`**: Sends httpOnly cookies automatically with every request.
- **No request interceptor** — cookies handle auth, no `Authorization` header needed.
- **Response interceptor**: On 401, attempts token refresh via `/auth/refresh` (cookie sent automatically). Queues concurrent 401s to avoid multiple refresh attempts. If refresh fails, dispatches `logout()` and redirects to `/login`.

---

## Service Pattern

Services are **classes**, singleton-exported, using `apiClient` and `API_ENDPOINTS`.

```typescript
class ItemService {
  async getItems(params?: ItemFilters & PaginationParams): Promise<PaginatedData<Item>>
  async getItem(id: string): Promise<Item>
  async createItem(data: CreateItemRequest): Promise<Item>
  async updateItem(id: string, data: UpdateItemRequest): Promise<Item>
  async deleteItem(id: string): Promise<void>
}
export const itemService = new ItemService();
```

Auth service methods: `register`, `login`, `logout`, `refreshToken`, `getMe`, `requestPasswordReset`, `resetPassword`.

---

## Error Handling

```typescript
// lib/utils/error.ts
export const getErrorMessage = (error: unknown): string => {
  // Checks: axios error → ApiError shape → network error → generic Error → fallback string
};
```

**Toast library**: `sonner`. Use `toast.success()`, `toast.error(getErrorMessage(error))`.

---

## Next.js Caching Defaults

| Data type | Strategy | Example |
|---|---|---|
| General content | `next: { revalidate: 60 }` | Items list |
| User-specific | `cache: 'no-store'` | User profile |
| Static lookups | `cache: 'force-cache'` | Categories, settings |

Use `revalidatePath()` / `revalidateTag()` in Server Actions after mutations.

---

## Forms

**Approach**: Hybrid — React Hook Form + Zod for client-side validation, Server Action for submission.

### Password Schema Requirements

```typescript
z.string()
  .min(8, 'Min 8 characters')
  .regex(/[A-Z]/, 'Must contain uppercase')
  .regex(/[a-z]/, 'Must contain lowercase')
  .regex(/[0-9]/, 'Must contain number')
```

### File Upload Validation

- Allowed types: `image/jpeg`, `image/png`, `image/webp`
- Max size: 5MB
- Validate extension AND MIME type

### Form Rules

- Show field-level errors below the field (red text + red border).
- Disable submit button during submission.
- Never clear the form on error — preserve user input.
- Use `useFormStatus` for pending states in Server Action forms.

---

## Utility Defaults

- **Default currency**: `USD` for `formatCurrency`.
- **Date format**: `Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' })`.
