# Deploying the whole platform on Render

Reference for deploying all three applications and the database. Every command,
path and variable name below comes from this repository.

* **Already running on Render?** Go to [Upgrading an existing deployment](#upgrading-an-existing-deployment).
* **First time?** Read on, then follow [Deployment order](#deployment-order).
* **After any deploy**, run the [Post-deploy checks](#post-deploy-checks).

## Architecture

```text
                              Internet (HTTPS)
             ┌───────────────────────┴───────────────────────┐
   byapar-web (Web Service)                    byapar-admin (Web Service)
   business-web/  Next.js                      frontend/  Next.js
   landing + /shop/*                           /admin/login, /platform/*
   /api/v1/* ── proxied ──┐                ┌── proxied ── /api/v1/*
                          │   API_URL      │
                          └───────┬────────┘
                         byapar-api (Web Service)
                         backend/  Express + Prisma
                         /api/v1/*   session = httpOnly cookies
                                     │  DATABASE_URL (Neon direct URL, TLS)
                                     │          ─── HTTPS ──> LlamaCloud (LLAMA_API_KEY, backend only)
                         Neon Postgres (outside Render)
                                     │
                         bill files: BILL_STORAGE_DIR (see "Uploaded bills")
```

* The browser only ever talks to the site it is on. Each Next.js app forwards `/api/v1/*` to
  the backend (a rewrite in its `next.config.mjs`, target `API_URL`). That keeps the login
  cookies first-party - see [How the session works](#how-the-session-works).
* The Next.js apps do no other server-side work: no API routes, no database access.
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
| `TRUST_PROXY` | Yes | `2` | Render's balancer + the frontend's `/api/v1` proxy. Wrong value = every visitor shares one rate limit | No |
| `JWT_EXPIRES_IN` | No | `15m` | access-token life; default `15m`. Remove an old `1d` value | No |
| `REFRESH_TOKEN_TTL_DAYS` | No | `30` | how long a sign-in lasts without activity; default 30 | No |
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
| `API_URL` | both | Yes | `https://byapar-api.onrender.com/api/v1` | No |
| `NEXT_PUBLIC_CONTACT_EMAIL` | web | No | `hello@yourdomain.com` | No (public) |
| `NEXT_PUBLIC_CONTACT_PHONE` | web | No | `+91 98765 43210` | No (public) |

These values are compiled in at build time: after changing one, use **Save, rebuild, and
deploy**. A plain restart keeps the old value. (`NEXT_PUBLIC_API_URL` from older setups is still
accepted in place of `API_URL`.)

### How the session works

Browsers never call byapar-api directly. Each frontend proxies `/api/v1/*` on its own origin to
`API_URL`, so the backend's session cookies are first-party there:

* `byapar_at`: the access token (15 min), httpOnly, sent with every API call.
* `byapar_rt`: the refresh token (30 days, rotated on every use, stored only as a hash),
  httpOnly, sent only to `/api/v1/auth/refresh` and `/logout`.

Both are `SameSite=Strict` and `Secure`, and no page script can read either. `*.onrender.com` is a
public suffix, so the API and the frontends are different *sites*; calling the API directly would
make these third-party cookies, which Safari drops. The proxy is what makes them work. It also
means the admin console and the shop app hold separate sessions.

Confirm `TRUST_PROXY` after deploying - see step 6 of [Post-deploy checks](#post-deploy-checks).

The business-web proxy waits up to 130 seconds for an answer (`experimental.proxyTimeout` in
`business-web/next.config.mjs`), because reading a bill with AI can take 20-90 seconds.

## Deployment order

For a brand-new setup.

1. Push the repository to GitHub.
2. Create the **Neon** project and copy its direct connection string.
3. Create **byapar-api** with `CORS_ORIGIN` left unset for now and `TRUST_PROXY=2`. Deploy; the
   start command applies all 19 migrations to the empty database.
4. Check `https://<api>/api/v1/health` and `/api/v1/health/db`.
5. Seed the platform superadmin (below).
6. Create **byapar-admin** with `API_URL`. Deploy.
7. Create **byapar-web** with `API_URL`. Deploy.
8. On byapar-api set `CORS_ORIGIN` to the two frontend URLs → **Save and deploy**
   (a runtime variable, no rebuild needed).
9. Run the [Post-deploy checks](#post-deploy-checks).

The backend goes first because both frontends need its URL at build time; CORS is set last
because it needs the frontend URLs. Render shows a service's URL as soon as it is created.

## Upgrading an existing deployment

For services that already run an older version (tokens in `localStorage`, the old shop menu).
This release brings:

* **Sign-in moves to httpOnly cookies with refresh tokens.** It adds one migration
  (`20260928090000_refresh_tokens`, a new `refresh_tokens` table; nothing existing changes)
  and two backend variables.
* **The Business Web shop app is reorganised**: new menu and URLs, Quick Billing, returns,
  products, stock adjustments, credit book, reports, recycle bin. Frontend only; no new
  environment variables. Old bookmarks (`/shop/inventory`, `/shop/credit`, `/shop/money-in`,
  `/shop/money-out`, `/shop/reports`) redirect to the new pages.

Do these in order. Set the variables **before** the code lands, so every service builds once
with the right settings.

1. **Back up the database first.** Neon → your project → **Branches** → **Create branch** from
   `main` (a free, instant copy). Name it `before-cookie-release`. You can delete it once the
   release is confirmed.
2. **If Auto-Deploy is on**, turn it off on all three services (**Settings** → **Auto-Deploy** →
   **No**) so the code does not deploy before the variables are set. Skip this if it is off.
3. **byapar-api → Environment:**
   * add `TRUST_PROXY` = `2`
   * `JWT_EXPIRES_IN`: delete it, or set `15m` (an old `1d` still works, just less safely)
   * optional: `REFRESH_TOKEN_TTL_DAYS` = `30` (the default)
   * **Save** only (not deploy yet)
4. **byapar-admin → Environment** and **byapar-web → Environment:**
   * add `API_URL` = the same value as the existing `NEXT_PUBLIC_API_URL`
     (for example `https://byapar-api.onrender.com/api/v1`)
   * delete `NEXT_PUBLIC_API_URL` (optional; it is still accepted)
   * **Save** only
5. **Push the code** to the branch Render deploys from (usually `main`).
6. **Deploy byapar-api first**: **Manual Deploy** → **Deploy latest commit**. Wait for "Live".
   The log must show `Applying migration 20260928090000_refresh_tokens` (or "No pending
   migrations" if it was applied before). If the migration fails, stop here - see
   [Troubleshooting](#troubleshooting); the frontends still run the old version meanwhile.
7. **Then deploy byapar-web and byapar-admin**: **Manual Deploy** → **Clear build cache &
   deploy** on each.
8. Turn Auto-Deploy back on if you turned it off.
9. Run the [Post-deploy checks](#post-deploy-checks).

What users notice: everyone is signed out once and signs in again. Between step 6 and the end of
step 7 (a few minutes) the old frontends cannot sign in, because the backend no longer returns a
token; deploy at a quiet hour.

**Rolling back.** Redeploy the previous commit on all three services (**Manual Deploy** →
**Deploy a specific commit**). The new `refresh_tokens` table can stay; old code ignores it. Only
restore the Neon branch from step 1 if data itself went wrong - that throws away everything
entered since.

## Post-deploy checks

Ten minutes, in a normal browser (not incognito for the first run).

1. **Health:** `https://<api>/api/v1/health` shows `ok`, and `/api/v1/health/db` too.
2. **Shop sign-in:** open byapar-web → **Sign in** as a shop owner. You land on **Home** with a
   greeting, Quick Billing, and today's figures.
3. **Cookies, not localStorage:** press F12 → **Application**:
   * **Cookies** → the byapar-web address: `byapar_at` and `byapar_rt`, both ticked
     **HttpOnly** and **Secure**
   * **Local Storage**: no token; only `byapar_business_signed_in = 1`
   * **Network** tab: API calls go to `byapar-web.onrender.com/api/v1/...`, not to byapar-api
4. **Staying signed in:** leave the tab open 20 minutes (longer than the 15-minute access
   token), then click anything. It must work without asking you to sign in again - the refresh
   happened quietly.
5. **Sign out** from the avatar menu, press the browser's Back button, and refresh: you are on
   the sign-in page, not back in.
6. **Rate limit is per visitor (`TRUST_PROXY`):** on the laptop, open any `/api/v1/...` request
   in the Network tab and note the `RateLimit-Remaining` response header (e.g. 290). Open the
   site on a phone using **mobile data** (not the same Wi-Fi) and check it the same way, or just
   confirm that repeated reloads on the laptop do not reduce the phone's count. The phone should
   start near 300. If it continues the laptop's count, everyone shares one limit: tell your
   developer, and set `TRUST_PROXY=1` meanwhile.
7. **The shop app, as the owner:**
   * **Quick Billing:** pick a customer and an item → **Save & complete** with **Part**
     payment → the result shows PAID and DUE amounts
   * **Sales → Invoices:** that invoice shows Paid / Due; open it → **Print**
   * **Stock → Low Stock** and **Stock Dashboard** load
   * **Customers → Credit Book** shows the customer owing the due amount
   * **Bill Import → Upload** a photo of a bill (only if `LLAMA_API_KEY` is set)
   * **Reports → Sales Reports** loads for this month
8. **As shop staff:** sign in as a staff user. **Add Purchase** and money actions are not
   offered; **Quick Billing** offers **Save draft** only.
9. **Admin console:** open byapar-admin → sign in as the platform admin → the platform
   dashboard loads, and its cookies are separate from byapar-web's.
10. **Old bookmarks:** `https://<web>/shop/inventory` lands on the Stock Dashboard.

If a check fails, see [Troubleshooting](#troubleshooting).

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

* Sign-in sets two **httpOnly cookies** (see [How the session works](#how-the-session-works)).
  No token is ever in a response body or in `localStorage`. Scripts and tests can still send
  `Authorization: Bearer <token>`; browsers do not.
* The access token lasts `JWT_EXPIRES_IN` (default 15 minutes) and is renewed quietly with the
  refresh token. **Sign out revokes the session on the server**, not just in the browser.
* Deactivating a user blocks them on their next request; their refresh token stops working too.
* CORS matters less now that browsers call their own site, but keep `CORS_ORIGIN` set to the two
  frontend origins. The server logs a warning in production if it is `*`.
* Rate limits: 300 requests / 15 min per visitor, 20 sign-ins / 15 min. They count each visitor
  separately only if `TRUST_PROXY` is right (`2` with the frontend proxies).

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

1. `API_URL` on both frontends → `https://api.example.com/api/v1` → Save, rebuild, and deploy.
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
| Login works locally, not on Render | `API_URL` missing or still localhost on that frontend | Set it; Save, rebuild, and deploy |
| Frontend still calls localhost | Built before the variable was set | Save, rebuild, and deploy |
| Login says "not connected to the server yet" | `API_URL` not set when the frontend was built | Same as above |
| API returns 404 through the site | `API_URL` missing `/api/v1` | It must end in `/api/v1` |
| Sign-in succeeds, then you are sent straight back to sign-in | Cookies not stored: the frontend is older than the backend, or a browser extension blocks cookies | Clear build cache & deploy both frontends; try a clean browser profile |
| Signed out every ~15 minutes | Refresh not working (old frontend build) | Clear build cache & deploy the frontend |
| Sign-in fails on the old frontend right after the backend deploy | Expected during an upgrade: old frontends expect a token in the body | Deploy the frontends (upgrade step 7) |
| `relation "refresh_tokens" does not exist` | Migration not applied | Check byapar-api's log for `prisma migrate deploy`; redeploy byapar-api |
| 401 on every request | `JWT_SECRET` changed, or session expired | Sign in again |
| Bill upload stops after ~2 minutes | Proxy timeout | Retry; a read over 130 s is cut off by the frontend proxy |
| Old link like `/shop/credit` shows 404 | Frontend older than this release | Deploy byapar-web |
| Next.js page 500 | See the service's Logs | Usually a runtime error in the log |
| Uploaded bill image missing | Ephemeral filesystem | Persistent disk or object storage |
| AI extraction 503 "not set up" | `LLAMA_API_KEY` missing, or LlamaCloud rejected it (401/403) | Add or replace the `llx-` key on byapar-api, Save and deploy |
| AI extraction 502/504 | LlamaCloud unavailable, or the read outran `LLAMA_TIMEOUT_MS` | Retry; raise the timeout; check credits at cloud.llamaindex.ai |
| AI extraction 429 | LlamaCloud rate limit | Wait and retry |
| AI extraction 422 | The model could not read this bill | Retake a clearer photo, or enter the bill manually |
| First request takes ~1 minute | Free instance spin-down | Expected; paid instances stay up |
| Rate limit hit by everyone at once ("Too many requests") | `TRUST_PROXY` wrong | Check post-deploy step 6; logs may show `ERR_ERL_` messages |
