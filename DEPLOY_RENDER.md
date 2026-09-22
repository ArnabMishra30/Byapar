# Deploying the whole platform on Render

Reference for deploying all three applications and the database. Every command,
path and variable name below comes from this repository.

## Architecture

```text
                              Internet (HTTPS)
             ┌───────────────────────┼───────────────────────┐
             │                       │                       │
   byapar-web (Web Service)  byapar-admin (Web Service)      │
   business-web/  Next.js    frontend/  Next.js              │
   landing + /shop/*         /admin/login, /platform/*       │
             │                       │                       │
             └──── browser calls ────┴──── NEXT_PUBLIC_API_URL
                                     │
                         byapar-api (Web Service)
                         backend/  Express + Prisma
                         /api/v1/*   CORS_ORIGIN = the two sites
                                     │  DATABASE_URL (Neon direct URL, TLS)
                                     │          ─── HTTPS ──> Llama API (LLAMA_API_KEY, backend only)
                         Neon Postgres (outside Render)
                                     │
                         bill files: BILL_STORAGE_DIR (see "Uploaded bills")
```

* The two Next.js apps have no server-side API calls. The **browser** calls the backend
  directly, so the backend URL must be public and HTTPS.
* Only the backend talks to Postgres. The database is Neon, outside Render, reached over the
  public internet with TLS (`sslmode=require`).
* There is no agency portal, no Redis, no cron job, no worker, and no Docker in this project.

## Services

Put all three Render services in the **same region**, and create the Neon project in the
**same city** (for example Render Singapore + Neon `ap-southeast-1` Singapore) so database
round trips stay short.

| | byapar-api | byapar-admin | byapar-web |
|---|---|---|---|
| Type | Web Service | Web Service | Web Service |
| Language | Node | Node | Node |
| Root Directory | `backend` | `frontend` | `business-web` |
| Build Command | `npm ci --include=dev && npx prisma generate` | `npm ci && npm run build` | `npm ci && npm run build` |
| Start Command | `npm run start:render` | `npm run start:render` | `npm run start:render` |
| Pre-Deploy Command | leave empty | — | — |
| Health Check Path | `/api/v1/health` | `/admin/login` | `/` |

Why these commands:

* **Backend build** uses `--include=dev` because `NODE_ENV=production` is set on the service,
  which would otherwise make npm skip the `prisma` CLI (a devDependency).
* **Backend start** (`prisma migrate deploy && node src/server.js`) applies pending migrations,
  then starts. `migrate deploy` only applies committed migrations; it never resets or drops.
  It runs on every start and is a no-op when nothing is pending. (On a paid instance you may
  move it to the Pre-Deploy Command `npx prisma migrate deploy` and use `npm start`.)
* **Frontend start** (`next start -H 0.0.0.0`) listens on Render's `PORT`. Do not use
  `npm start` on Render: it is pinned to 3001/3002 for local development.
* **Do not set `NODE_ENV`** on the two Next.js services (their builds need devDependencies).

## Environment variables

Set in each service → **Environment** → **Add Environment Variable**.
Never put a real value in any committed file.

### byapar-api (backend)

| Variable | Required | Example format | Where to get it | Secret |
|---|---|---|---|---|
| `NODE_VERSION` | Yes | `22` | fixed | No |
| `NODE_ENV` | Yes | `production` | fixed | No |
| `DATABASE_URL` | Yes | `postgresql://user:pass@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require` | Neon → Connect → **direct (unpooled)** string, not the `-pooler` one | **Yes** |
| `JWT_SECRET` | Yes | 64 random characters | generate (below); never reuse the local one | **Yes** |
| `CORS_ORIGIN` | Yes | `https://byapar-admin.onrender.com,https://byapar-web.onrender.com` | the two frontend URLs, no trailing slash | No |
| `JWT_EXPIRES_IN` | No | `1d` | default `1d` | No |
| `LOG_LEVEL` | No | `info` | default `info` | No |
| `LLAMA_API_KEY` | For AI bill reading | `llx-...` | LlamaCloud (cloud.llamaindex.ai) → API Keys | **Yes** |
| `LLAMA_BASE_URL` | No | `https://api.cloud.llamaindex.ai` | default shown | No |
| `LLAMA_EXTRACT_TIER` | No | `cost_effective` | `fast`, `cost_effective`, `agentic`, `agentic_plus` | No |
| `LLAMA_PROJECT_ID` | No | a project UUID | only for an account with several projects | No |
| `LLAMA_TIMEOUT_MS` | No | `90000` | default; covers upload + job + polling | No |
| `BILL_STORAGE_DIR` | With a disk | `/var/data/bills` | the disk's mount path + `/bills` | No |
| `BILL_MAX_FILE_SIZE` | No | `10485760` | default 10 MB | No |

Do **not** set `PORT` (Render provides it). `ADMIN_*` and `PLATFORM_ADMIN_*` are only read by
seed scripts run from your computer; they do not belong on the service.

Generate a JWT secret:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

Changing `JWT_SECRET` later signs every user out.

### byapar-admin and byapar-web

| Variable | Service | Required | Example | Secret |
|---|---|---|---|---|
| `NODE_VERSION` | both | Yes | `22` | No |
| `NEXT_PUBLIC_API_URL` | both | Yes | `https://byapar-api.onrender.com/api/v1` | No (public) |
| `NEXT_PUBLIC_CONTACT_EMAIL` | web | No | `hello@yourdomain.com` | No (public) |
| `NEXT_PUBLIC_CONTACT_PHONE` | web | No | `+91 98765 43210` | No (public) |

`NEXT_PUBLIC_*` values are compiled into the JavaScript at build time: after changing one, use
**Save, rebuild, and deploy**. A plain restart keeps the old value.

## Deployment order

1. Push the repository to GitHub.
2. Create the **Neon** project and copy its direct connection string.
3. Create **byapar-api** with `CORS_ORIGIN` left unset for now. Deploy; the start command applies
   all 18 migrations to the empty database.
4. Check `https://<api>/api/v1/health` and `/api/v1/health/db`.
5. Seed the platform superadmin (below).
6. Create **byapar-admin** with `NEXT_PUBLIC_API_URL`. Deploy.
7. Create **byapar-web** with `NEXT_PUBLIC_API_URL`. Deploy.
8. On byapar-api set `CORS_ORIGIN` to the two frontend URLs → **Save and deploy**
   (a runtime variable, no rebuild needed).
9. Test end to end.

The backend goes first because both frontends need its URL at build time; CORS is set last
because it needs the frontend URLs. Render shows a service's URL as soon as it is created.

## Database

| | Local | Test | Render production |
|---|---|---|---|
| Where | your PC, `backend/.env` | your PC, `backend/.env.test` | Neon (cloud) |
| Used by | `npm run dev` | `npm test` (wiped by tests) | byapar-api |
| Migrations | `prisma migrate dev` | test setup | `prisma migrate deploy` only |

**Provider: Neon.** The Free plan gives 0.5 GB of storage per project and 100 compute-hours a
month, and **nothing is deleted** when a limit is reached — writes simply start failing until
space is freed or the plan is upgraded. Instant restore history is 6 hours; for longer backups,
upgrade. Choose PostgreSQL 18 to match local development.

**Scale to zero.** On the Free plan the compute sleeps after 5 minutes of inactivity and cannot
be kept awake. The next query wakes it, which adds about half a second — and the first request
after a long idle can occasionally fail while both Render and Neon wake up. `connect_timeout=15`
in the connection string gives Neon time to start.

**Which URL.** Neon offers two connection strings. Use the **direct (unpooled)** one — the host
*without* `-pooler` — everywhere: on byapar-api and from your own computer.

```text
postgresql://<user>:<password>@ep-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&connect_timeout=15
```

* The pooled (`-pooler`) string runs through PgBouncer in transaction mode, which cannot run
  `prisma migrate deploy` and drops session features. This backend is one long-running server
  with its own small Prisma pool, so it does not need PgBouncer.
* Keep `sslmode=require`. If Neon's copy button adds `channel_binding=require`, delete that part.
* Only if you later run the backend on many instances, switch to the pooled string and add a
  `directUrl` for migrations in `schema.prisma`.

**Never run against production:** `prisma migrate dev`, `prisma migrate reset`,
`prisma db push`, `npm run seed:demo`, or `npm test`. The demo seed refuses a non-local
database and `NODE_ENV=production`, but do not rely on that.

**Seed the platform superadmin** (Render free instances have no Shell, and Neon is reachable
from anywhere, so run it from your computer):

```powershell
cd C:\Personal\byapar-clone\backend
$env:DATABASE_URL = "<the same Neon direct URL used on Render>"
$env:PLATFORM_ADMIN_EMAIL = "you@yourdomain.com"
$env:PLATFORM_ADMIN_PASSWORD = Read-Host "Choose the platform admin password"
npm run seed:platform
Remove-Item Env:DATABASE_URL, Env:PLATFORM_ADMIN_EMAIL, Env:PLATFORM_ADMIN_PASSWORD
```

It creates a `PLATFORM_ADMIN` with no company, never overwrites an existing password, and
refuses an email that already belongs to a shop user. Shop owners and sales staff are then
created from the admin panel.

The Neon database is reachable from any IP with the password. Restricting that (Neon's IP Allow)
is a paid feature, so keep the connection string secret: it lives only in Render's Environment
tab and your local `backend/.env`, never in git.

## Authentication and CORS

* Login returns a **JWT**; both frontends keep it in `localStorage` and send
  `Authorization: Bearer <token>`. **No cookies, no refresh tokens, no `credentials: include`.**
* So there are no SameSite/secure-cookie settings to configure. CORS only needs the two
  frontend origins in `CORS_ORIGIN`. The server logs a warning in production if it is `*`.
* Tokens last `JWT_EXPIRES_IN` (default 1 day). Logout discards the token in the browser.
* The backend trusts one proxy hop in production so rate limits (300 requests / 15 min per
  visitor, 20 logins / 15 min) count each visitor separately.

## Uploaded bills

Bills are written to the backend's **local filesystem** (`BILL_STORAGE_DIR`, default
`./storage/bills`); the database stores only the key. Render's filesystem is **ephemeral**:
files are lost on every redeploy, restart and (on Free) spin-down after 15 idle minutes.
The extracted fields stay in the database; opening the original afterwards shows
"The uploaded file is no longer available."

| Option | Code change | Survives redeploys |
|---|---|---|
| Free instance, no disk | none | No — testing only |
| Paid instance + Persistent Disk, mount `/var/data`, `BILL_STORAGE_DIR=/var/data/bills` | none | Yes (single instance; a few seconds of downtime per deploy) |
| Object storage (S3 / R2) | yes, in `bill-storage.service.js` | Yes |

AI flow: browser uploads to `POST /api/v1/bills` → backend stores the file → backend sends it to
LlamaCloud (LlamaExtract): upload to `/api/v1/beta/files`, create a job at `/api/v2/extract` with
the bill schema, poll until it completes → the returned fields are validated against the same
schema and saved as a draft → the shop owner reviews and edits → confirm posts through the normal
purchase/sales flow. A read takes roughly 20–30 seconds. Without `LLAMA_API_KEY` the upload
reports "Automatic bill reading is not set up" (503); there is no fake extraction.

## Custom domains (later)

| Domain | Service |
|---|---|
| `www.example.com` | byapar-web |
| `admin.example.com` | byapar-admin |
| `api.example.com` | byapar-api |

Service → **Settings** → **Custom Domains** → **Add Custom Domain**, then create the DNS record
Render shows (a CNAME to `<service>.onrender.com` for subdomains). Render issues the HTTPS
certificate automatically once DNS resolves. Afterwards:

1. `NEXT_PUBLIC_API_URL` on both frontends → `https://api.example.com/api/v1` → Save, rebuild, and deploy.
2. `CORS_ORIGIN` on the backend → `https://www.example.com,https://admin.example.com` → Save and deploy.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Build: `Could not find package.json` | Wrong Root Directory | Set `backend`, `frontend` or `business-web` |
| `npm ci` lock file error | `package-lock.json` out of sync | `npm install` locally in that folder, commit the lock file |
| `prisma: not found` / Prisma generate failed | Build without `--include=dev` | Use the backend build command above |
| Next build: `Cannot find module 'tailwindcss'` | `NODE_ENV=production` on a frontend | Remove it from that service |
| `Cannot find module` only on Render | Import case differs from file name, or file not committed | Fix the import / commit the file |
| Odd build or runtime errors | Node version | `NODE_VERSION=22` on every service |
| `Invalid environment configuration: DATABASE_URL / JWT_SECRET` then exit 1 | Missing/short variable | Add it; `JWT_SECRET` needs 32+ characters |
| `P1001 Can't reach database server` | Wrong URL, or Neon compute waking up | Check the string; add `connect_timeout=15`; retry once |
| Migration fails with a prepared-statement or "transaction mode" error | Using Neon's `-pooler` string | Use the direct (unpooled) host |
| `invalid connection string` / unknown parameter | `channel_binding=require` left in the URL | Remove it, keep `sslmode=require` |
| `P3009` / `P3018` migration failed | A migration failed partway | Read the log; never `migrate reset` in production. Fix, then `prisma migrate resolve` as the error instructs |
| "No open ports detected" / timed out | Wrong start command | `npm run start:render` |
| Browser: CORS error | Origin not in `CORS_ORIGIN` | Add the exact URL (https, no trailing slash), Save and deploy |
| Login works locally, not on Render | `NEXT_PUBLIC_API_URL` missing/localhost, or CORS | Set both; frontends need a rebuild |
| Frontend still calls localhost | Built before the variable was set | Save, rebuild, and deploy |
| Login says "not connected to the server yet" | `NEXT_PUBLIC_API_URL` not set at build | Same as above |
| API returns 404 | URL missing `/api/v1` | `NEXT_PUBLIC_API_URL` must end in `/api/v1` |
| 401 on every request | `JWT_SECRET` changed, or token expired | Log in again |
| Next.js page 500 | See the service's Logs | Usually a runtime error in the log |
| Uploaded bill image missing | Ephemeral filesystem | Persistent disk or object storage |
| AI extraction 503 "not set up" | `LLAMA_API_KEY` missing, or LlamaCloud rejected it (401/403) | Add or replace the `llx-` key on byapar-api, Save and deploy |
| AI extraction 502/504 | LlamaCloud unavailable, or the read outran `LLAMA_TIMEOUT_MS` | Retry; raise the timeout; check credits at cloud.llamaindex.ai |
| AI extraction 429 | LlamaCloud rate limit | Wait and retry |
| AI extraction 422 | The model could not read this bill | Retake a clearer photo, or enter the bill manually |
| First request takes ~1 minute | Free instance spin-down | Expected; paid instances stay up |
| Rate limit hit by everyone at once | Proxy trust wrong | Check logs for `ERR_ERL_` messages |
