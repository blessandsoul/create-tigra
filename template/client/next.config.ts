import type { NextConfig } from "next";

// SECURITY HEADERS / CSP NOTE:
// All security headers — including the Content-Security-Policy — are set in
// src/middleware.ts, which is the SINGLE SOURCE OF TRUTH for them. The CSP is
// per-request and nonce-based ('strict-dynamic'), which a static headers() block
// here cannot express, and emitting a CSP from both places would produce a
// conflicting duplicate Content-Security-Policy header. Do NOT add a headers()
// CSP back here. HSTS is managed at the Cloudflare edge.

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // Next 16.2+ rejects staleTimes.static below 30 (config schema enforces gte(30));
    // an invalid value is ignored entirely, silently re-enabling the Router Cache.
    // 30s is the closest allowed to "never serve stale RSC payloads on back-navigation".
    // dynamic: 0 (still unconstrained) is what protects data pages — never raise it.
    staleTimes: { dynamic: 0, static: 30 },
  },
};

export default nextConfig;
