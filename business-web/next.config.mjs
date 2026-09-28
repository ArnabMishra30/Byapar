import { resolveApiTarget } from "./api-target.mjs";

const apiTarget = resolveApiTarget(process.env);

// The backend URL is baked into the build (rewrites are). A production build
// made without it, or pointing at localhost, cannot reach the backend once
// deployed. Warn rather than fail: the public landing page works without the
// backend, and a first deploy may come before the backend.
if (process.env.NODE_ENV === "production") {
  if (!apiTarget) {
    console.warn(
      "\n⚠ API_URL is not set. The landing page will work, but login and the shop app cannot reach the backend. Set it and redeploy.\n",
    );
  } else if (/localhost|127\.0\.0\.1/.test(apiTarget)) {
    console.warn(
      `\n⚠ API_URL is ${apiTarget}. That only works on this computer, not on a deployed site.\n`,
    );
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },

  // Lets the browser code say "not connected" instead of a vague 404. Not a
  // secret: it is only whether a backend was configured.
  env: { BYAPAR_API_CONFIGURED: apiTarget ? "true" : "false" },

  experimental: {
    // The proxy's own timeout (default 30s). A bill upload waits for the AI
    // reader, which the backend allows up to 90s; give it headroom.
    proxyTimeout: 130_000,
  },

  // The shop login lives at /shop/login. /login is where people guess it is,
  // so it forwards there rather than 404ing. Temporary, in case /login ever
  // needs to become a real page.
  async redirects() {
    return [{ source: "/login", destination: "/shop/login", permanent: false }];
  },

  // Same-origin API: see api-target.mjs for why.
  async rewrites() {
    if (!apiTarget) return [];
    return [{ source: "/api/v1/:path*", destination: `${apiTarget}/:path*` }];
  },
};

export default nextConfig;
