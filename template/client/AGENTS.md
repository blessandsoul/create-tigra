# Client Codex instructions

## Architecture and naming

- Use Server Components by default. Add `'use client'` only for browser APIs, hooks, local state, or event handlers.
- Put routes in `src/app/`, domain behavior in `src/features/<domain>/`, reusable primitives in `src/components/ui/`, and cross-domain components in `src/components/common/` or `src/components/layout/`.
- Components use `PascalCase.tsx`, hooks use `use<Name>.ts`, services use `<domain>.service.ts`, types use `<domain>.types.ts`, and Redux slices use `<domain>Slice.ts`.
- Use `AppLink` for internal links and `useAppRouter` for programmatic navigation so the shared navigation/loading behavior remains consistent.

## Sources of truth

- Server-rendered page data belongs in Server Components; client-fetched server data belongs in React Query; Redux is limited to the authenticated-user lifecycle; local and URL state stay local or in search params.
- `src/lib/constants/routes.ts` and `api-endpoints.ts` own application and API paths.
- `src/styles/themes/default.css` owns color values. Components use semantic Tailwind tokens; do not hardcode palette values or create competing theme variables.
- If a `next/font` CSS variable is referenced by a token declared on `:root`, apply that font's generated variable class to `<html>`. Never attach it only to `<body>`, where it cannot resolve the root-scoped token.
- `src/middleware.ts` is the single source of truth for security headers and nonce-based CSP. Do not add a second CSP in `next.config.ts`.

## Security and deployment

- Treat client validation as UX only; the server must validate and authorize every request.
- Use the shared credentialed API client. Auth tokens remain in httpOnly cookies and must never enter browser storage or Redux.
- Sanitize any intentionally rendered HTML and untrusted URLs. Never log passwords, tokens, credentials, or complete sensitive user objects.
- Preserve `output: "standalone"`, the non-root container, and the root health check. Add every new public environment variable to the Docker builder as `ARG` + `ENV`; public variables are compiled into the bundle.
