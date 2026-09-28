import { resolveApiTarget } from "./api-target.mjs";

const apiTarget = resolveApiTarget(process.env);

// The backend URL is baked into the build (rewrites are). A production build
// made without it, or pointing at localhost, cannot reach the backend once
// deployed.
if (process.env.NODE_ENV === "production") {
  if (!apiTarget) {
    console.warn(
      "\n⚠ API_URL is not set. The admin console cannot reach the backend. Set it and redeploy.\n",
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
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },

  // Lets the browser code say "not connected" instead of a vague 404. Not a
  // secret: it is only whether a backend was configured.
  env: { BYAPAR_API_CONFIGURED: apiTarget ? "true" : "false" },

  // Same-origin API, so the httpOnly session cookies stay first-party. See
  // api-target.mjs.
  async rewrites() {
    if (!apiTarget) return [];
    return [{ source: "/api/v1/:path*", destination: `${apiTarget}/:path*` }];
  },
};

export default nextConfig;
