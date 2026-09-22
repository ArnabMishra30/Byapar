// NEXT_PUBLIC_API_URL is compiled into the browser bundle during `next build`.
// A production build made without it, or pointing at localhost, cannot reach
// the backend once deployed. Warn rather than fail: the public landing page
// works without the backend, and a first deploy may come before the backend.
if (process.env.NODE_ENV === "production") {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (!apiUrl) {
    console.warn(
      "\n⚠ NEXT_PUBLIC_API_URL is not set. The landing page will work, but login and the shop app cannot reach the backend. Set it and redeploy.\n",
    );
  } else if (/localhost|127\.0\.0\.1/.test(apiUrl)) {
    console.warn(
      `\n⚠ NEXT_PUBLIC_API_URL is ${apiUrl}. That only works on this computer, not on a deployed site.\n`,
    );
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },

  // The shop login lives at /shop/login. /login is where people guess it is,
  // so it forwards there rather than 404ing. Temporary, in case /login ever
  // needs to become a real page.
  async redirects() {
    return [{ source: "/login", destination: "/shop/login", permanent: false }];
  },
};

export default nextConfig;
