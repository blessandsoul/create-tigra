import type { NextConfig } from "next";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
const apiOrigin = (() => {
  try {
    return new URL(apiBaseUrl).origin;
  } catch {
    return "http://localhost:8000";
  }
})();

// 'unsafe-eval' is required by Next.js dev mode (HMR/react-refresh) but must
// NOT ship to production. 'unsafe-inline' stays in both modes — the Next.js
// inline runtime requires it unless a full nonce infrastructure is added.
const isDev = process.env.NODE_ENV === "development";
const scriptSrc = `script-src 'self'${isDev ? " 'unsafe-eval'" : ""} 'unsafe-inline'`;

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // Next 16.2+ rejects staleTimes.static below 30 (config schema enforces gte(30));
    // an invalid value is ignored entirely, silently re-enabling the Router Cache.
    // 30s is the closest allowed to "never serve stale RSC payloads on back-navigation".
    // dynamic: 0 (still unconstrained) is what protects data pages — never raise it.
    staleTimes: { dynamic: 0, static: 30 },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "origin-when-cross-origin" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              scriptSrc,
              "style-src 'self' 'unsafe-inline'",
              `img-src 'self' blob: data: https: ${apiOrigin}`,
              "font-src 'self'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
              `connect-src 'self' ${apiOrigin}`,
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
