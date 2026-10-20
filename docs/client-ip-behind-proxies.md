# Client IP behind proxies and Cloudflare

Rate limits, the login lockout (email + IP), the IP auto-block and the manual block list all key on the visitor's address. From 4.0.0, the server finds that address by **verifying before believing**. No setting is needed, and it works behind Cloudflare, behind Coolify's Traefik alone, and for direct visitors.

## How the address is chosen

`server/src/libs/client-ip.ts`, used by every caller through `getClientIp()`:

1. Fastify's `trustProxy` is `'loopback,linklocal,uniquelocal'`. Only our own proxy is trusted: Coolify's Traefik reaches the app from a private Docker-network address. `request.ip` is therefore the right-most hop that is **not** trusted, which is the address Traefik saw connecting to it. Anything a visitor writes into `X-Forwarded-For` sits to the left of that and is never used.
2. If that address belongs to Cloudflare's published edge ranges (`server/src/libs/cloudflare-ranges.ts`), the request came from Cloudflare's network. Its `CF-Connecting-IP` is believed only when the request is also verified as this app's own zone traffic:
    - with `CLOUDFLARE_ORIGIN_SECRET` set, it must carry the matching `X-Origin-Verify` header, which a Transform Rule on your zone adds;
    - without the secret, it must not carry the `CF-Worker` header that Cloudflare adds to Worker subrequests.
    An unverified Cloudflare request is keyed on one fixed bucket (`cloudflare-unverified`), never on the address it claims.
3. Otherwise that address is the visitor: a direct visitor, a grey-cloud domain, or a sslip.io address.

The Cloudflare ranges are bundled in the code and refreshed daily (`server/src/jobs/refresh-cloudflare-ranges.job.ts`). A failed or implausible download keeps the current list.

`GET /api/v1/admin/client-ip` (admin only) returns the address resolved for that request and its source: `cloudflare`, `cloudflare-unverified`, `proxy` or `socket`. Use it after a deploy or a proxy change. Seeing `cloudflare-unverified` through your own domain means the Transform Rule is missing or its value differs from `CLOUDFLARE_ORIGIN_SECRET`, and every visitor then shares one counter: fix that first.

## Why Cloudflare's ranges alone are not proof

The ranges are shared by every Cloudflare customer. Anyone can run a Cloudflare Worker (free) that fetches one of your app's addresses that is not behind Cloudflare (the sslip.io address, a grey-cloud record, the server IP). Such a request leaves from Cloudflare's ranges, and Cloudflare documents that the Worker controls `CF-Connecting-IP` there. Without a check, that would be a free way to forge visitor addresses again.

- **Zero-config protection:** Cloudflare adds a `CF-Worker` header to Worker subrequests, and such requests are not believed. Cloudflare documents that it adds the header, but not that a Worker cannot remove it.
- **Full protection (recommended for every app behind Cloudflare):** set `CLOUDFLARE_ORIGIN_SECRET` and a Transform Rule on your zone that adds `X-Origin-Verify` with the same value (Rules > Transform Rules > Modify Request Header, scoped to the app's hostname). Only traffic through your own zone can carry it. This is Cloudflare's own recommended origin proof ("HTTP header validation").
- **Free extra step:** remove the sslip.io address from apps that are served through Cloudflare, so no non-Cloudflare address exists to begin with.

## Why it changed

The previous version had two problems:

- It believed the LEFT-most `X-Forwarded-For` entry, which is written by the visitor.
- With `TRUST_CLOUDFLARE=true`, it believed `CF-Connecting-IP` from anyone, including requests that skipped Cloudflare through the server's own IP or a sslip.io address.

So a client could choose its own key. It could dodge rate limits and the login lockout, or get somebody else's address banned.

The version before that used the TCP peer only. That counted every visitor behind Cloudflare or Traefik as one address, so a few users locked each other out. The current design fixes both problems:

- every real visitor gets their own counter;
- no visitor can choose theirs.

## Limits

- **Another CDN or proxy:** behind anything other than Cloudflare (with or without Traefik), the resolved address is that proxy's. Counters are then shared: strict, but never spoofable. Supporting another CDN means adding its ranges the way Cloudflare's are handled.
- **Shared connections:** people who really share one internet connection (an office, a café, some mobile carriers) count as one visitor for any IP-based rule. Size the limits with `RATE_LIMIT_MULTIPLIER` and `RATE_LIMIT_OVERRIDES` (see `template/server/docs/rate-limits.md`).
- **The private-network assumption:** anything on a private network in front of the app is trusted. On Coolify that is Traefik and other containers on the same Docker network. Do not expose the app's port directly on a network you do not control.

## Porting an existing app

For apps scaffolded before this change:

1. Copy `server/src/libs/client-ip.ts` and `server/src/libs/cloudflare-ranges.ts` from the template, and `server/src/jobs/refresh-cloudflare-ranges.job.ts` (register it in `server/src/jobs/index.ts`).
2. In `server/src/app.ts`, set `trustProxy: TRUSTED_PROXY_RANGES` (imported from `@libs/client-ip.js`) instead of `env.NODE_ENV === 'production'` or `true`.
3. Make sure every use of the visitor address goes through `getClientIp(request)`: the rate-limit `keyGenerator` and `onExceeded`, the IP-block check, auth/session IP, the request logger, and the email-verification controller if the module is installed. Search for `request.ip`, `x-forwarded-for` and `cf-connecting-ip`.
4. Remove `TRUST_CLOUDFLARE` from `server/src/config/env.ts` and add `CLOUDFLARE_ORIGIN_SECRET` as in the template. Leaving `TRUST_CLOUDFLARE` set in Coolify is harmless: it is ignored.
5. Behind Cloudflare: generate a secret, put it in the app's Coolify env as `CLOUDFLARE_ORIGIN_SECRET`, and add the Transform Rule on the zone. Do both in the same change: the env without the rule makes every visitor `cloudflare-unverified`.
6. Optionally add the admin endpoint (`GET /admin/client-ip` in the admin module) and copy the tests from `server/src/libs/__tests__/client-ip.test.ts` and `cloudflare-ranges.test.ts`.
7. After deploying, open `/api/v1/admin/client-ip` through the real domain while logged in as an admin. It must show your own public address, with source `cloudflare` behind Cloudflare or `proxy` without it, never a Cloudflare, Docker or Traefik address and never `cloudflare-unverified`.

The same release also removes `DATABASE_POOL_MIN` and `DATABASE_POOL_MAX`. They never sized anything. Size the Prisma pool with `?connection_limit=N&pool_timeout=S` in `DATABASE_URL`.
