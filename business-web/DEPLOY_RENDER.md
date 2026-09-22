# Deploying Business Web on Render

> Deploying the whole platform (backend, database, admin panel)? Follow
> [`../DEPLOY_RENDER.md`](../DEPLOY_RENDER.md). This file covers Business Web alone.

Business Web is a Next.js 14 App Router project. It runs as a **Render Web Service**
(Node), not a Static Site: it uses a server-side redirect (`/login` → `/shop/login`)
and dynamic routes such as `/shop/sales/[id]`, which a static export cannot serve.

The repository holds three projects (`backend/`, `frontend/`, `business-web/`), so
the service's **Root Directory must be `business-web`**.

## Render settings

| Setting | Value |
|---|---|
| Service type | Web Service |
| Language | Node |
| Branch | `main` (or whichever branch you deploy) |
| Root Directory | `business-web` |
| Build Command | `npm ci && npm run build` |
| Start Command | `npm run start:render` |
| Health Check Path | `/` |
| Instance type | Free is fine for the landing page |

`npm run start:render` runs `next start -H 0.0.0.0` with no `-p`, so Next.js listens on
the `PORT` Render provides. Do not use `npm start` on Render: it is pinned to port 3002
for local development.

**Set `NODE_VERSION=22` in the Environment tab.** Render's default for new services is
Node 24, which this Next.js 14 project has not been tested on; the build is verified on
Node 22. Render reads `.node-version` from the *repository* root, so the
`business-web/.node-version` file (used by local version managers) is not enough on its
own — the environment variable is what pins Render.

## Environment variables

All of these are `NEXT_PUBLIC_`, which means they are **compiled into the browser
JavaScript during the build** and are readable by anyone. They are not secrets, and no
secret may ever be given a `NEXT_PUBLIC_` name. The AI key, database URL and JWT secret
belong only to the backend service.

Because they are read at build time, **redeploy after changing any of them**.

| Variable | Public/secret | Needed now? | Value |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | Public | Only for login and the shop app | `https://<backend>.onrender.com/api/v1` |
| `NEXT_PUBLIC_CONTACT_EMAIL` | Public | Optional | e.g. `hello@yourdomain.com` |
| `NEXT_PUBLIC_CONTACT_PHONE` | Public | Optional | e.g. `+91 98765 43210` |
| `NODE_VERSION` | Not sensitive | **Required** | `22` |

Without `NEXT_PUBLIC_API_URL` the landing page works fully; pricing shows the plans
configured in `src/features/landing/site-config.ts`, and the build log prints a warning.
Login shows "This site is not connected to the server yet."

Do **not** set `NODE_ENV=production` on this service. Render's build then skips
devDependencies (Tailwind, TypeScript, ESLint) and `next build` fails. Next.js sets
production mode itself.

## When the backend is deployed

1. Set `NEXT_PUBLIC_API_URL` on this service to the backend URL ending in `/api/v1`, then redeploy.
2. On the backend service, add this site's URL to `CORS_ORIGIN`, e.g.
   `CORS_ORIGIN=https://byapar-business-web.onrender.com` (comma-separate several origins).
   The app sends a bearer token, not cookies, so nothing else is needed for CORS.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `npm ci` fails: "missing package-lock.json" or wrong files | Root Directory is empty or wrong. Set it to `business-web`. |
| `npm ci` fails: lock file out of sync | Run `npm install` locally in `business-web`, commit `package-lock.json`. |
| `Cannot find module 'tailwindcss'` / `typescript` | `NODE_ENV=production` is set on the service. Remove it. |
| `Module not found` that works on Windows | Import path case differs from the file name (Linux is case-sensitive), or the file was never committed. |
| Build fails on a type or lint error | The build runs `tsc` and ESLint. Run `npm run build` locally, fix, push. |
| Deploy stuck at "no open ports detected" / timed out | Start command is not `npm run start:render`, or it passes `-p 3002`. |
| Login says it cannot reach the server | `NEXT_PUBLIC_API_URL` missing, wrong, or still `localhost`. Fix, then redeploy (a restart is not enough). |
| Browser console shows a CORS error | Backend `CORS_ORIGIN` does not include this site's URL. |
| First visit takes ~1 minute | Free instances sleep after 15 minutes idle. Normal; upgrade the instance to avoid it. |
| Old code still served | Manual Deploy → "Clear build cache & deploy". |
