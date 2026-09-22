// NEXT_PUBLIC_API_URL is compiled into the browser bundle during `next build`.
// A production build made without it, or pointing at localhost, cannot reach
// the backend once deployed.
if (process.env.NODE_ENV === "production") {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (!apiUrl) {
    console.warn(
      "\n⚠ NEXT_PUBLIC_API_URL is not set. The admin console cannot reach the backend. Set it and redeploy.\n",
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
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
