> **SCOPE**: These rules apply specifically to the **client** directory (Next.js App Router).

# Security

## Token Storage

- **httpOnly cookies** (`access_token` + `refresh_token`) set by the server via `Set-Cookie` headers.
- Tokens are **never accessible from JavaScript** — no localStorage, no Redux token state.
- Axios sends cookies automatically via `withCredentials: true`.
- `AuthInitializer` hydrates user state on page load by calling `getMe()` (cookie sent automatically).
- On logout: call logout API endpoint (server clears cookies), dispatch `logout()` action, redirect to `/login`.

## Environment Variables

- **Never prefix secrets with `NEXT_PUBLIC_`** — only public values (API URL, app name) get the prefix.
- Server-only secrets (DB URL, JWT secret) have no prefix and are only accessible in Server Components / Server Actions.
- Validate env with Zod at startup.

## File Upload Validation

- Allowed types: `image/jpeg`, `image/png`, `image/webp`
- Max size: 5MB
- Validate both MIME type AND file extension.

## Security Headers (`next.config.ts`)

```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: origin-when-cross-origin
X-XSS-Protection: 1; mode=block
```

## Content Security Policy

```
default-src 'self';
script-src 'self' 'unsafe-eval' 'unsafe-inline';
style-src 'self' 'unsafe-inline';
img-src 'self' blob: data: https:;
font-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none';
connect-src 'self' ${NEXT_PUBLIC_API_BASE_URL};
```

## Rules

1. **Never inject raw HTML** without sanitizing it first (use DOMPurify with allowed tags/attrs).
2. **Never log sensitive data** (tokens, passwords, full user objects). Dev-only: log IDs at most.
3. **Validate all inputs** with Zod — client-side (UX) AND server-side (security).
4. **External links**: Always `target="_blank" rel="noopener noreferrer"`.
5. **Sanitize URLs**: Only allow `http:`, `https:`, `mailto:` protocols before rendering as links.
