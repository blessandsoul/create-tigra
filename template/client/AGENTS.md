# Client agent instructions

## Architecture and naming

- Use Server Components by default. Add `'use client'` only for browser APIs, hooks, local state, or event handlers.
- Put routes in `src/app/`, domain behavior in `src/features/<domain>/`, reusable primitives in `src/components/ui/`, and cross-domain components in `src/components/common/` or `src/components/layout/`.
- Components use `PascalCase.tsx`, hooks use `use<Name>.ts`, services use `<domain>.service.ts`, types use `<domain>.types.ts`, and Redux slices use `<domain>Slice.ts`.
- Use `AppLink` for internal links and `useAppRouter` for programmatic navigation so the shared navigation/loading behavior remains consistent.

## Sources of truth

- Server-rendered page data belongs in Server Components; client-fetched server data belongs in React Query; Redux is limited to the authenticated-user lifecycle; local and URL state stay local or in search params.
- Redux has one store per visitor (`makeStore` in `src/store/index.ts`, created in `Providers`). Never import a store instance into a module: the API client reports a session that ended through `src/lib/api/session-events.ts`, and `AuthInitializer` clears the user.
- `src/lib/constants/routes.ts` and `api-endpoints.ts` own application and API paths. `PROTECTED_PATHS` and `AUTH_PATHS` there are the one list each that the proxy and `AuthInitializer` use, matched by whole path segments (`src/lib/utils/paths.ts`): add your protected areas there.
- The start-up "who am I" check runs only when the browser holds the server's `auth_session` marker (`src/lib/utils/session-marker.ts`), so anonymous visitors make no API calls.
- `src/styles/themes/default.css` owns color values. Components use semantic Tailwind tokens; do not hardcode palette values or create competing theme variables.
- If a `next/font` CSS variable is referenced by a token declared on `:root`, apply that font's generated variable class to `<html>`. Never attach it only to `<body>`, where it cannot resolve the root-scoped token.
- `src/proxy.ts` (Next 16's name for middleware) is the single source of truth for security headers and nonce-based CSP. Do not add a second CSP in `next.config.ts`.

## Security and deployment

- Treat client validation as UX only; the server must validate and authorize every request. Forms put the server's 422 messages on their own fields with `applyFieldErrors` (`src/lib/utils/form.ts`); keep `RegisterForm`'s rules equal to the server's `registerSchema`.
- Use the shared credentialed API client. Auth tokens remain in httpOnly cookies and must never enter browser storage or Redux.
- Sanitize any intentionally rendered HTML and untrusted URLs. Never log passwords, tokens, credentials, or complete sensitive user objects.
- Preserve `output: "standalone"`, the non-root container, and the `/healthz` health check (`src/app/healthz/route.ts`, used by the Dockerfile HEALTHCHECK; keep it answering 200 without rendering a page). Add every new public environment variable to the Docker builder as `ARG` + `ENV`; public variables are compiled into the bundle. The build stops when `NEXT_PUBLIC_API_BASE_URL` is empty (in Coolify it needs "Available at Buildtime").
- Changes to `src/proxy.ts`, the sign-in flow and its redirects (`src/features/auth/`), the shared API client (`src/lib/api/axios.config.ts`), or anything that renders HTML or untrusted URLs go through the root `AGENTS.md` security workflow.

## Tests

- `npm test` (and `npm run test:coverage`, which CI runs and which fails below the floor in `vitest.config.mts`) runs the unit tests in `src/**/__tests__/`. Keep logic in functions under `src/lib/` and test it there; a test file that needs `document` or `window` starts with `// @vitest-environment jsdom`.
- The template ships no pages on purpose. Screens are proven by hand in a browser against a running server; the logic under them is what the unit tests cover.
