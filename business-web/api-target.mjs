/**
 * Where the Express backend lives, for the /api/v1 proxy in next.config.mjs.
 *
 * The browser never calls the backend directly. It calls /api/v1 on THIS site,
 * and Next.js forwards the request. That keeps the session cookies first-party:
 * the backend sets them httpOnly and SameSite=Strict, which a browser would
 * refuse (or Safari would drop) if the API sat on a different site, as it does
 * on *.onrender.com.
 *
 * API_URL is the server-side setting. NEXT_PUBLIC_API_URL is still honoured so
 * an existing deployment keeps working without an environment change. Both are
 * read at BUILD time: Next.js bakes rewrites into the build.
 *
 * Development falls back to the local backend; a production build never does.
 *
 * @param {{ API_URL?: string, NEXT_PUBLIC_API_URL?: string, NODE_ENV?: string }} env
 * @returns {string} The backend's /api/v1 base URL, or "" when not configured.
 */
export function resolveApiTarget(env) {
  const configured = (env.API_URL || env.NEXT_PUBLIC_API_URL || "").trim().replace(/\/+$/, "");
  if (configured) return configured;
  return env.NODE_ENV === "production" ? "" : "http://localhost:4000/api/v1";
}
