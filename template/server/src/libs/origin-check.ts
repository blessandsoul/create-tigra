/**
 * CSRF defense-in-depth — Origin verification for state-changing requests.
 *
 * With cross-origin cookie deployments (sameSite=none), browsers attach auth
 * cookies to cross-site requests. CORS only protects *reading* responses — it
 * does not stop the side effects of a forged POST/PUT/PATCH/DELETE. This check
 * rejects browser-originated state-changing requests whose Origin header is
 * neither the API itself (same-origin) nor a configured CORS origin.
 *
 * Deliberately conservative:
 * - No Origin header → ALLOWED. Non-browser clients (curl, Postman,
 *   server-to-server) omit it, and they carry no ambient cookies, so they are
 *   not CSRF vectors. Browsers always send Origin on cross-site state-changing
 *   requests, which is the only case this defends against.
 * - allowAllOrigins (development CORS) → ALLOWED.
 */
export function isOriginAllowed(
  origin: string | undefined,
  requestHost: string | undefined,
  allowedOrigins: ReadonlySet<string>,
  allowAllOrigins: boolean,
): boolean {
  if (!origin) return true; // non-browser client — not a CSRF vector
  if (allowAllOrigins) return true; // development: CORS allows all origins
  if (allowedOrigins.has(origin)) return true; // configured cross-origin client

  // Same-origin request: the Origin's host matches the request's Host header.
  // Compared scheme-insensitively — TLS usually terminates at the reverse
  // proxy, so the API may see the request as http while Origin says https.
  // The Host header is lowercased before comparing: `new URL()` normalizes the
  // Origin's host to lowercase, but the raw Host header arrives as-sent and
  // host names are case-insensitive (RFC 9110).
  try {
    return requestHost !== undefined && new URL(origin).host === requestHost.toLowerCase();
  } catch {
    return false; // malformed Origin header — reject
  }
}
