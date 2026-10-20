# Client

The web app: Next.js 16 (App Router, Server Components by default), React 19, TypeScript, Tailwind CSS v4 and
shadcn/ui, React Query for server data, Redux Toolkit for the signed-in user, Vitest.

It ships the wiring, not the screens: a welcome page, error and not-found pages, the `/healthz` health check, and
everything your own pages need to talk to the API safely.

## Layout

```text
client/src/
├── app/                   routes: page.tsx (welcome), layout.tsx, providers.tsx, error, not-found, healthz/
│   ├── (auth)/            a centred layout for your sign-in pages
│   └── (main)/            the layout with Header and Footer for the rest
├── proxy.ts               runs before every page: CSP nonce, security headers, protected-page redirect
├── features/
│   ├── auth/              useAuth, useCurrentUser, AuthInitializer, LoginForm, RegisterForm,
│   │                      ForgotPasswordForm, LimitNotice, usePasswordReset, auth.service
│   └── admin/             hooks and a service for stats, users and sessions
├── components/            ui/ (shadcn), common/ (AppLink, SafeImage, ConfirmDialog, Pagination, …), layout/
├── lib/
│   ├── api/               axios.config.ts (the API client), session-events.ts
│   ├── constants/         routes.ts (every page path, PROTECTED_PATHS), api-endpoints.ts
│   └── utils/             error and field-error parsing, safe redirects, paths, the session marker, forms
├── store/                 makeStore(): one Redux store per visitor
└── styles/                theme tokens (light and dark) and fonts
```

## Commands

```bash
npm run dev                  # http://localhost:3000, with fast refresh
npm test                     # unit tests
npm run test:coverage        # with the coverage floor (vitest.config.mts)
npm run lint && npm run typecheck
npm run build                # production build (standalone output, what the Docker image runs)
```

`NEXT_PUBLIC_API_BASE_URL` (in `.env`, written when the project was created) is the API address, for example
`http://localhost:8000/api/v1`. Every `NEXT_PUBLIC_*` value is public and is baked into the build.

## Adding your pages

Put them at the paths in `src/lib/constants/routes.ts`; the proxy, the API client and the server's emails already
send people there.

```tsx
// src/app/(auth)/login/page.tsx
import { LoginForm } from '@/features/auth/components/LoginForm';

export default function LoginPage() {
  return <LoginForm />;
}
```

| Path | Page | Use |
|---|---|---|
| `/login` | sign in | `LoginForm`: reads `?from=` and returns there, but only to a page of this site |
| `/register` | sign up | `RegisterForm` |
| your choice | forgot password | `ForgotPasswordForm` |
| `/reset-password` | new password from the emailed `?token=` | `useResetPassword` |
| `/verify-account` | email verification (email module) | `useVerifyAccount`, `useSendVerification` |
| `/dashboard`, `/profile`, `/admin`, and below | signed-in areas | `useCurrentUser`, `useAuth`, the admin hooks |

The forms already show the server's "slow down" answers with the wait time (`LimitNotice`) and its field errors
under their fields (`applyFieldErrors`). Building your own form on `useAuth`? Do the same, as `LoginForm` does.

Pages that need a signed-in visitor are listed once, in `PROTECTED_PATHS` (`routes.ts`), and matched by whole path
segments: `/admin` covers `/admin/users`, never `/administrator`. Add your own areas there. The proxy only checks
that a session marker exists; the API decides what each user may see.

## How sign-in works

```text
sign in      the API sets httpOnly cookies: access_token, refresh_token, and auth_session (a non-secret marker)
start-up     AuthInitializer asks "who am I" (GET /auth/me), only when the auth_session marker is present;
             anonymous visitors make no API calls at all
401          the API client refreshes once (parallel requests wait for that one refresh), then replays the request
lost race    another tab refreshed first (401 REFRESH_TOKEN_ROTATED): its fresh cookies are already in the
             browser, so the request is replayed and nobody is signed out
dead session the refresh is refused: the user is signed out and sent to /login
banned       a call answers 403 ACCOUNT_DEACTIVATED: the client signs out through the logout route at once
```

Tokens never reach JavaScript. The signed-in user lives in Redux (`state.auth`); read it with `useAppSelector` or
`useAuth`. Server data belongs in React Query, page data in Server Components.

## Security headers

`src/proxy.ts` (Next 16's name for middleware) is the one place for them. Each request gets a fresh CSP nonce with
`strict-dynamic`; Next stamps it on its own scripts. Do not add a second CSP in `next.config.ts`. A script you add
inline needs the nonce from the `x-nonce` header (see `app/layout.tsx`).

## Tests

Unit tests sit next to the code in `__tests__/` folders: the API client's session rules, the proxy, redirect safety,
paths, the session marker, error parsing, the store. Keep logic in functions under `src/lib/` and test it there; a
test that needs `document` or `window` starts with `// @vitest-environment jsdom`. CI runs `npm run test:coverage`.

## Deploying

The `Dockerfile` builds the standalone server and runs it as a non-root user, with a health check on `/healthz`.
On Coolify, set `NEXT_PUBLIC_API_BASE_URL` with "Available at Buildtime" ticked: the build stops without it. The
full checklist is in the server's `docs/deployment.md` and the create-tigra README.

`AGENTS.md` in this folder has the rules for changing this code.
