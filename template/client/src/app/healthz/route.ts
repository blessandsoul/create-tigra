/**
 * GET /healthz: the container health check (client/Dockerfile HEALTHCHECK,
 * which Coolify also uses to decide when a rolling deploy may switch over).
 *
 * Answers 200 without rendering a page, reading cookies or calling the API,
 * so it says only "this Next.js server is up". The check used to request `/`,
 * which fails as soon as a project makes its home page redirect (to /login,
 * /dashboard, a locale...): the container never became healthy and every
 * deploy failed. Excluded from the proxy (src/proxy.ts matcher), so
 * no auth redirect or CSP work runs for it; it returns no data.
 */
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
}
