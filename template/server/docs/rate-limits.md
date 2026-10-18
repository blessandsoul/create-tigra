# Rate limits, login lockout and IP blocks

Everything that slows down or stops a visitor, in one place. The limits themselves live in `src/config/rate-limit.config.ts`, the single source; the wiring is in `src/libs/rate-limiting.ts`.

## How counting works

- **Per visitor IP.** The key is the verified client IP (`getClientIp`, see `src/libs/client-ip.ts`), never an address the visitor wrote into a header.
- **Per route.** Every route keeps its own counter, even when two routes share a limit entry.
- **Shared across server processes.** Counters live in Redis.
- **Every "slow down" answer says how long to wait** in `retryAfterSeconds` (whole seconds) inside the JSON body. The client runs on another origin and CORS does not expose the `Retry-After` header to it.

## Route limits

| Route | Limit (per IP) | Name |
|---|---|---|
| `POST /auth/register` | 40 per hour | `AUTH_REGISTER` |
| `POST /auth/login` | 100 per 15 min | `AUTH_LOGIN` |
| `POST /auth/logout` | 200 per 15 min | `AUTH_LOGOUT` |
| `POST /auth/refresh` | 200 per 15 min | `AUTH_REFRESH` |
| `POST /auth/forgot-password` | 20 per 15 min (+ email cap) | `AUTH_FORGOT_PASSWORD` |
| `POST /auth/reset-password` | 100 per 15 min | `AUTH_RESET_PASSWORD` |
| `GET /auth/me` | 200 per minute | `AUTH_ME` |
| `GET /auth/sessions` | 30 per minute | `AUTH_SESSIONS` |
| `POST /auth/logout-all` | 10 per 15 min | `AUTH_LOGOUT_ALL` |
| `POST /auth/send-verification` (email module) | 10 per 15 min (+ email cap) | `AUTH_SEND_VERIFICATION` |
| `POST /auth/verify-account` (email module) | 10 per 15 min | `AUTH_VERIFY_ACCOUNT` |
| `PATCH /users/me`, `PATCH /users/:userId` | 30 per minute | `USERS_UPDATE_PROFILE` |
| `PATCH /users/me/password`, `PATCH /users/:userId/password` | 10 per 15 min | `USERS_CHANGE_PASSWORD` |
| `DELETE /users/me`, `DELETE /users/:userId` | 10 per minute | `USERS_DELETE_ACCOUNT` |
| `POST /users/avatar`, `POST /users/:userId/avatar` | 10 per minute | `USERS_UPLOAD_AVATAR` |
| `DELETE /users/avatar`, `DELETE /users/:userId/avatar` | 30 per minute | `USERS_DELETE_AVATAR` |
| `GET /users/:userId/avatar` | 100 per minute | `USERS_GET_AVATAR` |
| `GET /files/:filename` | 100 per minute | `FILES_GET` |
| every `/admin/*` route | 30 per minute | `ADMIN_DEFAULT` |
| **any other route** (including routes you add) | 200 per minute | `DEFAULT` |
| unknown URLs (404s) | 200 per minute, one shared counter | `DEFAULT` |

All paths are under `/api/v1`. Password change checks the current password, so it stays low: someone holding a stolen session cannot guess that password. An avatar upload decodes an image of up to 50 MP, which is real CPU work.

**Never limited:**
- `GET /api/v1/health`, `/api/v1/ready` and `/api/v1/live` (health probes come from infrastructure IPs);
- static `/uploads/*` (one page can load dozens of avatars);
- CORS preflights (`OPTIONS`).

A new route gets `DEFAULT` automatically. Give it its own entry in `RATE_LIMITS` and `config: { rateLimit: RATE_LIMITS.MY_ROUTE }` when it needs a different number.

## Email cap

At most **3 emails per hour to one address**, shared by every flow that emails someone: forgot-password, send-verification, the verification email at register, and the re-send when an unverified user signs in.

- It is counted **before** looking the account up, so unknown addresses count exactly like real ones and the answer reveals nothing.
- Redis keys are a SHA-256 of the address; raw emails are never stored there.
- Over the cap, forgot-password and send-verification answer `429 EMAIL_RATE_LIMITED`.
- Register still succeeds, and the sign-in re-send still runs. They skip the email and log it. The user can request a new email later and is told how long to wait.

The IP limits alone cannot do this: someone with many IPs could flood one inbox and burn the sender's quota and reputation.

## Login lockout

This is separate from the route limits, and counted per **email + IP pair**. An attacker therefore only locks out their own address and can never lock the real user out remotely.

- The 15th failed sign-in locks that pair for **15 minutes**.
- The 30th failure (and every 15th after it) locks it for **1 hour**.
- The failure count is forgotten an hour after the last failure, and a successful sign-in clears it.
- While locked, every attempt, even with the right password, gets `429 LOGIN_LOCKED`: "Too many failed sign-in attempts. Try again in N minutes."
- Unknown emails are counted and locked the same way and take the same password-check time (a dummy hash). Neither the lock nor the timing reveals which emails are registered.
- A wrong password outside a lock still says "Invalid email or password".

## IP auto-block

- Every request **over a limit** on a non-auth route records one strike against the IP. Requests to `/api/v1/auth/*` add no strikes, so a mistyped password can never ban a whole network.
- `IP_AUTO_BLOCK_THRESHOLD` strikes (default 20) within `IP_AUTO_BLOCK_WINDOW_SECONDS` (default 300) block the IP on **every** route for `IP_AUTO_BLOCK_DURATION_SECONDS` (default 3600). The answer is `403 IP_BLOCKED` with `retryAfterSeconds`.
- Private, loopback and reserved addresses (your own proxy) are never auto-blocked. Health probes are never blocked.
- Admins can add permanent blocks (`/admin/blocked-ips`). Those answer `403 IP_BLOCKED` "Access from your network is blocked." with no wait time.

Before you shorten a window, read the note at the top of `rate-limit.config.ts`. A client that keeps hammering a short-window route after its 429 bans itself within minutes.

## Response shape

```json
{ "success": false, "error": { "code": "LOGIN_LOCKED", "message": "Too many failed sign-in attempts. Try again in 14 minutes.", "retryAfterSeconds": 840 } }
```

| Code | Status | When |
|---|---|---|
| `RATE_LIMIT_EXCEEDED` | 429 | a route limit (or the default) was exceeded |
| `LOGIN_LOCKED` | 429 | too many failed sign-ins for this email + IP |
| `EMAIL_RATE_LIMITED` | 429 | too many emails to this address this hour |
| `IP_BLOCKED` | 403 | the IP is auto-blocked (`retryAfterSeconds` set) or permanently blocked (not set) |

**The client** (`client/src/lib/api/axios.config.ts`):
- It shows one toast with the wait time for these codes.
- The login, register and forgot-password forms show the message inline instead.
- React Query never retries these answers, because a retry would only earn another strike.
- A limited `/auth/refresh` never logs the user out.

## Changing limits (ENV)

| Variable | Default | Meaning |
|---|---|---|
| `RATE_LIMIT_ENABLED` | `true` | Master switch. `false` makes every limit 1,000,000 (the email cap too). |
| `RATE_LIMIT_MULTIPLIER` | `1` | Scales every max, e.g. `10` for local development. |
| `RATE_LIMIT_OVERRIDES` | (empty) | Change single limits: `NAME=MAX/WINDOW,...` with `WINDOW` like `30s`, `15m` or `1h`. |

Example: `RATE_LIMIT_OVERRIDES=AUTH_LOGIN=200/15m,DEFAULT=300/1m,EMAIL_PER_ADDRESS=5/1h`

- `NAME` is any name from the table above (`RATE_LIMITS` keys), `DEFAULT` or `EMAIL_PER_ADDRESS`.
- An override replaces that limit's max and window; the multiplier still applies on top.
- An unknown name or a malformed value stops the server at boot with the list of valid names, so a typo never goes unnoticed.
- The old `RATE_LIMIT_AUTH_LOGIN_MAX` and `RATE_LIMIT_AUTH_REGISTER_MAX` are no longer read. If one is still set, the server logs a warning at boot and ignores it.

## When Redis is down

The app keeps serving, but while Redis is unreachable:
- rate limits, the email cap and the login lockout are off;
- IP blocks are not enforced;
- forgot-password and send-verification answer 500, because their tokens are stored in Redis.

`/api/v1/health` reports `degraded`. Everything returns on its own when Redis is back; permanent blocks are re-loaded from the database on reconnect.

## Behind Cloudflare

Cloudflare requests that cannot be verified as your own zone's traffic share **one** counter. This happens in two cases:
- an origin secret is set without its Transform Rule;
- the traffic comes through a Cloudflare Worker.

On a correct setup this never happens. The server logs `[CLIENT-IP] Cloudflare requests ... share one rate-limit bucket` (at most every 10 minutes) when it does. See `docs/client-ip-behind-proxies.md` in the create-tigra repository.

## Known limits (read before relying on these)

- **Anyone can use up an address's email quota.** Three anonymous forgot-password or send-verification requests in an hour use up that address's cap. That protects the inbox from flooding, but for the rest of the hour nobody gets a reset link, and an unverified user gets no verification link (register and the sign-in re-send skip the email silently). Someone who keeps doing it every hour can keep one person from resetting their password or verifying. A verified user who knows their password is not affected (the login lockout is per email + IP).
- **Parallel sign-in attempts can get ahead of the lockout.** A burst of simultaneous failed sign-ins from one IP is checked before any of them is counted, so it can try more than 15 passwords. It is still capped by the login route limit (100 per 15 minutes per IP).
- **`HEAD` requests count separately from `GET`.** Fastify adds a `HEAD` route for each `GET`, and it gets its own counter.

## Porting to an app made with an older create-tigra

1. Copy `src/config/rate-limit.config.ts`, `src/libs/rate-limiting.ts` and `src/libs/email-quota.ts`. Then copy the `app.ts` changes (`registerRateLimiting`, `registerNotFoundHandler`, `rateLimit: false` on the health routes, `getIpBlock`), `TooManyRequestsError` and `retryAfterSeconds` in `shared/errors`, `errorResponse`, and the auth-service lockout.
2. Replace `RATE_LIMIT_AUTH_LOGIN_MAX` / `RATE_LIMIT_AUTH_REGISTER_MAX` in every environment with `RATE_LIMIT_OVERRIDES`, for example `AUTH_LOGIN=100/15m`. Remember that the old variables are now ignored.
3. Drop the two dead lockout columns with a migration. Nothing reads them any more:
   ```sql
   ALTER TABLE `users` DROP COLUMN `failedLoginAttempts`, DROP COLUMN `lockedUntil`;
   ```
   These are the template's column names (the fields have no `@map`). Or remove `failedLoginAttempts` and `lockedUntil` from the `User` model and let `prisma migrate dev` generate the migration.
4. Client: copy `getLimitInfo` / `isLimitError` / `formatWait` (`lib/utils/error.ts`), the interceptor branch and the refresh check (`lib/api/axios.config.ts`), the `retry` function (`app/providers.tsx`), `LimitNotice` and the form changes.
