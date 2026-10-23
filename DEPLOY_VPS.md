# Deploying byapar-clone on a Hostinger VPS (KVM1)

Self-hosted alternative to `DEPLOY_RENDER.md`. One VPS runs all three apps behind
Nginx. Every command, path and variable name below comes from this repository.

```text
                         Internet (HTTPS, ports 80/443)
                                    │
                                 Nginx  (reverse proxy + Let's Encrypt TLS)
                 ┌──────────────────┴──────────────────┐
        app.example.com                         ops.example.com
        → 127.0.0.1:3002                        → 127.0.0.1:3001
        business-web (Next.js)                  frontend (Next.js)
        landing + /shop/*                       /admin/login, /platform/*
              │                                       │
              │  each Next app rewrites /api/v1/*  →  http://127.0.0.1:4000/api/v1
              └───────────────────┬───────────────────┘
                         127.0.0.1:4000
                         backend (Express + Prisma)   ← NOT exposed publicly
                                    │
                         PostgreSQL (Neon over TLS, or local — see step 4)
```

Key idea (same as Render): the browser only ever talks to the site it is on. Each
Next app forwards `/api/v1/*` to the backend over localhost, so the session cookies
stay first-party. The backend and ports 3001/3002/4000 are never exposed to the
internet — only Nginx on 80/443 is.

**KVM1 = 1 vCPU / 4 GB RAM.** Enough, but Next builds spike memory. We add swap and
build one app at a time (step 6).

---

## 0. Finish creating the VPS (the Hostinger wizard)

1. **Location:** India — select it (your screenshot: *Excellent 78 ms*).
2. **OS / template:** choose a **plain OS**, not a control-panel image.
   Pick **Ubuntu 24.04 LTS (64-bit)**. Do NOT pick CyberPanel / CloudPanel / cPanel —
   this guide installs Nginx directly and a panel would fight it.
3. **Panel:** "No panel" / skip.
4. **Root password:** set a strong one (save it). Add your SSH public key if offered.
5. Finish. Hostinger shows the server's **public IP** — you'll need it below.

---

## 1. Point DNS at the VPS (do this early — TLS needs it)

In your domain's DNS, create two **A records** → the VPS IP:

| Host | Type | Value |
|---|---|---|
| `app` | A | `SERVER_IP` |
| `ops` | A | `SERVER_IP` |

(Use whatever names you like; `app` = shop app, `ops` = operator console. You can
also use the bare domain for one of them.) DNS can take a few minutes to propagate.

---

## 2. First login + basic hardening

From your Windows machine (PowerShell):

```powershell
ssh root@SERVER_IP
```

Then on the server:

```bash
# Update everything
apt update && apt upgrade -y

# Create a non-root sudo user (replace 'deploy')
adduser deploy
usermod -aG sudo deploy

# (optional but recommended) copy your SSH key to the new user, then log in as deploy
# From here on, work as 'deploy'. Re-login:  ssh deploy@SERVER_IP

# Add 2 GB swap so Next builds don't OOM on 4 GB
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Firewall: only SSH + web
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

---

## 3. Install the stack (Node 22, PM2, Nginx, Git)

```bash
# Node 22 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git nginx

node -v   # v22.x
npm -v

# PM2 (process manager, keeps apps running + restarts on reboot)
sudo npm install -g pm2
```

---

## 4. Database — pick ONE

### Option A — keep Neon (fastest to get running; already configured)
Nothing to install. You'll reuse your existing Neon **direct (unpooled)**
`DATABASE_URL` in step 5. Simplest, but adds ~cross-region latency from India.

### Option B — PostgreSQL on this VPS (lowest latency, fully self-hosted)
```bash
sudo apt install -y postgresql
sudo -u postgres psql <<'SQL'
CREATE USER byapar WITH PASSWORD 'CHOOSE_A_STRONG_PASSWORD';
CREATE DATABASE byapar OWNER byapar;
SQL
```
Then your `DATABASE_URL` is:
`postgresql://byapar:CHOOSE_A_STRONG_PASSWORD@127.0.0.1:5432/byapar?schema=public`
(You own backups now — e.g. a nightly `pg_dump` cron.)

---

## 5. Get the code + configure the backend env

```bash
sudo mkdir -p /var/www && sudo chown -R $USER:$USER /var/www
cd /var/www
git clone <YOUR_REPO_URL> byapar-clone
cd byapar-clone
```

Generate a JWT secret:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Create **`backend/.env`** (dotenv loads it at runtime AND for seed scripts). Fill in
your values — never commit this file:

```ini
NODE_ENV=production
PORT=4000
# Option A: your Neon direct/unpooled URL. Option B: the local URL from step 4.
DATABASE_URL=postgresql://...sslmode=require
JWT_SECRET=<paste the 96-char hex from above>
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_TTL_DAYS=30

# Behind Nginx on the same box = exactly 1 proxy hop.
TRUST_PROXY=1

# Public origins that serve the apps (used by CORS). Match your domains.
CORS_ORIGIN=https://app.example.com,https://ops.example.com

LOG_LEVEL=info

# Bill AI import (optional — leave unset to disable; /bills returns 503 without it)
# LLAMA_API_KEY=...
BILL_STORAGE_DIR=/var/www/byapar-clone/backend/bill-storage

# Only read by seed scripts (step 7). Safe to keep here.
PLATFORM_ADMIN_EMAIL=you@example.com
PLATFORM_ADMIN_PASSWORD=<strong>
PLATFORM_ADMIN_NAME=Platform Admin
ADMIN_EMAIL=owner@example.com
ADMIN_PASSWORD=<strong>
ADMIN_NAME=Shop Owner
ADMIN_COMPANY_NAME=Demo Shop
```

---

## 6. Install deps, run migrations, build

Install for all three packages (each has its own lockfile). Do **not** export
`NODE_ENV=production` in this shell — the Next builds need devDependencies, and the
backend build needs the Prisma CLI.

```bash
cd /var/www/byapar-clone

# Backend
cd backend
npm ci
npx prisma generate
npx prisma migrate deploy        # creates/updates the schema
mkdir -p bill-storage
cd ..

# Admin console (frontend). API_URL is baked in at BUILD time and points at the
# local backend — the Next server proxies to it; the browser never sees it.
cd frontend
npm ci
API_URL=http://127.0.0.1:4000/api/v1 npm run build
cd ..

# Shop app (business-web) — build after the first one finishes (RAM).
cd business-web
npm ci
API_URL=http://127.0.0.1:4000/api/v1 npm run build
cd ..
```

> The build prints a harmless warning that `API_URL is http://127.0.0.1...` — that's
> expected here: the proxy target is local because the backend is on this same VPS.

---

## 7. Seed the first users (once)

```bash
cd /var/www/byapar-clone/backend
npm run seed:platform      # creates the PLATFORM_ADMIN from backend/.env
# optional demo shop + data:
# npm run seed:demo
```

---

## 8. Run all three with PM2

Create **`/var/www/byapar-clone/ecosystem.config.cjs`**:

```js
module.exports = {
  apps: [
    {
      name: "byapar-api",
      cwd: "/var/www/byapar-clone/backend",
      script: "npm",
      args: "start",            // = node src/server.js ; reads backend/.env via dotenv
    },
    {
      name: "byapar-ops",
      cwd: "/var/www/byapar-clone/frontend",
      script: "npm",
      args: "start",            // = next start -p 3001
    },
    {
      name: "byapar-app",
      cwd: "/var/www/byapar-clone/business-web",
      script: "npm",
      args: "start",            // = next start -p 3002
    },
  ],
};
```

Start + persist across reboots:
```bash
cd /var/www/byapar-clone
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd -u $USER --hp $HOME   # run the command it prints
pm2 status
```

Smoke test locally:
```bash
curl -s http://127.0.0.1:4000/api/v1/health   # {"success":true,...}
curl -sI http://127.0.0.1:3002 | head -1       # shop app
curl -sI http://127.0.0.1:3001 | head -1       # ops console
```

---

## 9. Nginx reverse proxy

Create **`/etc/nginx/sites-available/byapar`**:

```nginx
# Shop app  → business-web (3002)
server {
    listen 80;
    server_name app.example.com;

    client_max_body_size 15M;   # bill/image uploads

    location / {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 130s;   # matches the bill-upload proxy timeout
    }
}

# Operator console → frontend (3001)
server {
    listen 80;
    server_name ops.example.com;

    client_max_body_size 15M;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 130s;
    }
}
```

Enable + reload:
```bash
sudo ln -s /etc/nginx/sites-available/byapar /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

---

## 10. HTTPS (Let's Encrypt)

DNS must already resolve to the VPS (step 1).
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d app.example.com -d ops.example.com
```
Certbot rewrites the Nginx blocks for 443 and auto-renews. `TRUST_PROXY=1` +
`X-Forwarded-Proto` let the backend know the request was HTTPS, so it issues
`Secure` session cookies correctly.

Done — open `https://app.example.com` (shop) and `https://ops.example.com` (operators).

---

## Deploying updates later

```bash
cd /var/www/byapar-clone
git pull

cd backend && npm ci && npx prisma generate && npx prisma migrate deploy && cd ..
cd frontend     && npm ci && API_URL=http://127.0.0.1:4000/api/v1 npm run build && cd ..
cd business-web && npm ci && API_URL=http://127.0.0.1:4000/api/v1 npm run build && cd ..

pm2 restart ecosystem.config.cjs
```

(If nothing in `backend/` changed, you can skip its three commands; if a Next app
didn't change, skip its rebuild.)

---

## Troubleshooting

- **`pm2 logs byapar-api`** / `byapar-app` / `byapar-ops` — per-app logs.
- **502 from Nginx** → the upstream app isn't up: `pm2 status`, then its logs.
- **Login works but you get logged out / "secure cookie" issues** → confirm you're
  on `https://`, `TRUST_PROXY=1` is set, and Nginx passes `X-Forwarded-Proto`.
- **Shop app loads but API calls 404/"not connected"** → the Next build didn't bake
  `API_URL`. Rebuild with `API_URL=http://127.0.0.1:4000/api/v1 npm run build`.
- **Build killed / OOM** → ensure swap is on (`free -h`), build one app at a time.
- **Bill upload 503** → `LLAMA_API_KEY` not set (feature optional).
- **Reset check:** `curl -s http://127.0.0.1:4000/api/v1/health`.

## Notes vs. the Render setup

- `start:render` scripts (and `-H 0.0.0.0`, `--include=dev`) are Render-specific; on
  the VPS we use `npm start` (ports 3001/3002) behind Nginx and full `npm ci`.
- `TRUST_PROXY=1` here (one Nginx hop) vs. `2` on Render (behind their proxy too).
- Bill files live on the VPS disk and **persist across redeploys** here (unlike
  Render) — but back them up with the DB if you rely on them.
