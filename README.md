# Byapar — Business Accounting SaaS

A multi-tenant accounting platform for small shops: a Node/Express API, a platform
console for the operator, and a mobile-first web app for shop owners.

Node.js + Express 5 + PostgreSQL + Prisma. JavaScript only (no TypeScript).

This repository currently contains the **backend foundation**: configuration, error handling,
validation, logging, authentication, health checks, role-based access control, multi-tenant
(company) scoping, user/company management, and business **master data** (categories, units,
taxes, warehouses, products, suppliers, customers, company settings).
On top of that it has the **inventory ledger** (stock balances and immutable stock
movements, costed with moving weighted average) and **purchases with purchase returns**
(supplier bills entered as drafts, which move stock only when posted), plus a
**supplier sub-ledger** tracking payables, credits and payments, and **sales with sales returns and a
customer sub-ledger** (invoices that move stock and freeze COGS, credit notes that
return stock at that frozen cost, receivables, and customer payments).
All of those documents post into a **double-entry general ledger** with a per-company
chart of accounts, immutable journal entries, and a trial balance, profit & loss and
balance sheet derived from them.
On top of that sits a **GST foundation**: company registration with GSTIN validation,
HSN/SAC classification, CGST/SGST/IGST rate components, place of supply, and input and
output tax summaries that reconcile to the ledger — and a **GST return preparation**
layer that arranges posted documents into GSTR-1 and GSTR-3B datasets with their own
reconciliation. Those datasets are for preparation and review: nothing is filed, and no
GST portal is contacted.

Finally there is the **business layer everyone uses**: a dashboard, twelve reports and a
credit book that answers "who owes me money, since when, and what is overdue".

**GST is optional.** This backend serves a GST-registered company and a small local shop
equally: the dashboard, the credit book and every business report work identically with no
GST registration at all, and none of them reads a GSTIN, a place of supply or a tax
component. GST reporting is additional, never a prerequisite.
GST return filing and AI are later phases.

---

# The three applications

This repository holds three separate projects. They share a database only through
the backend API; neither frontend talks to PostgreSQL and neither imports code
from the other.

| Directory | What it is | Port | Who uses it |
|---|---|---|---|
| `backend/` | The API and the accounting engine. The source of truth. | 4000 | — |
| `frontend/` | **Platform console** (admin panel) | 3001 | Platform Super Admin, Sales Representatives |
| `business-web/` | **Shop web app** + public marketing site | 3002 | Shop Owners, Shop Staff, and the public |

> **A note on directory names.** The two frontends are what a spec would call
> `admin-panel` and `web-app`. They are named `frontend/` and `business-web/`
> here for historical reasons. They are, and have always been, separate Next.js
> projects with their own `package.json`, dependencies, build and port — renaming
> the folders would be cosmetic.

## Local URLs

| | URL |
|---|---|
| **Landing page** (public marketing site) | http://localhost:3002/ |
| **Shop login** | http://localhost:3002/shop/login |
| Shop dashboard | http://localhost:3002/shop/dashboard |
| **Platform console login** | http://localhost:3001/admin/login |
| Platform overview | http://localhost:3001/platform |
| API | http://localhost:4000/api/v1 |

Sales Representatives sign in at the **platform** login — there is no separate
`/sales/login`. The console shows them their own role and only the pages their
permissions allow, so a second login screen would add a URL without adding a
boundary.

## Running it

```bash
# 1. the API
cd backend && npm run dev            # :4000

# 2. the platform console
cd frontend && npm run dev           # :3001

# 3. the shop app and landing page
cd business-web && npm run dev       # :3002
```

## Roles, and what they are called

The database enum has said `ADMIN` and `STAFF` since the first migration.
Renaming it would mean touching every authorization check in the backend to fix
a wording problem, so **the enum is unchanged and the wording is mapped** in
`lib/auth/roles.ts` in each frontend.

| Stored as | Shown as | Belongs to | `companyId` | Can reach |
|---|---|---|---|---|
| `PLATFORM_ADMIN` | **Platform Super Admin** | the operator | **null** | Everything on the platform: all shops, plans, the sales team, manual subscription grants |
| `SALES_STAFF` | **Sales Representative** | the operator | **null** | Only what their permission list allows — typically signing up shops and selling plans |
| `ADMIN` | **Shop Owner** | one shop | required | That one shop, completely |
| `STAFF` | **Shop Staff** | one shop | required | That one shop, preparing documents for an owner to post |

**`ADMIN` has never meant platform administrator.** It means the owner of one
shop. It used to be displayed as "Administrator" in both applications, which is
how a support call starts with everybody confused about who they are talking to.
That wording is gone.

A platform account has **no company**, and that single fact is what keeps it out
of every shop's books: shop routes derive their tenant from `req.user.companyId`.
The shop app also refuses a platform account at its login with a clear message,
as a courtesy — the backend already refuses them every shop route regardless.

## Demo accounts

```bash
cd backend && npm run seed:demo
```

Creates one account of each role plus a demo shop. **Refuses to run with
`NODE_ENV=production`** — these passwords are published right here.

| Role | Email | Sign in at |
|---|---|---|
| Platform Super Admin | `superadmin@byapar.test` | http://localhost:3001/admin/login |
| Sales Representative | `sales@byapar.test` | http://localhost:3001/admin/login |
| Shop Owner | `owner@demoshop.test` | http://localhost:3002/shop/login |
| Shop Staff | `staff@demoshop.test` | http://localhost:3002/shop/login |

Password for all four: `Demo@12345`

The demo shop starts with **no subscription**, which is deliberate — grant one
from the platform console to see the subscription guard release. Credentials live
in a seed script, never in frontend source and never on a login screen: a login
page that advertises a password is both a security problem and, once the password
changes, a support problem that looks exactly like a broken login.

## What is not implemented

- **No payment gateway.** No Razorpay, Stripe, PayPal or webhooks. Subscriptions
  are sold and renewed by a sales representative, who records the payment, or
  granted outright by the Platform Super Admin. The shop app says so plainly
  rather than showing a dead "Pay now" button.
- **No mobile app.** The shop web app is built mobile-first and runs in a phone
  browser. There is no React Native or Flutter application.
- **AI bill extraction needs credentials.** It requires `LLAMA_API_KEY` on the
  **backend**. Without it, bill upload reports that automatic reading is not set
  up and the shop types the bill in by hand; nothing else is affected. These
  variables are server-side only and have **no `NEXT_PUBLIC_` counterpart** —
  anything with that prefix is compiled into JavaScript every visitor can read.

## Architecture

```
Route  ->  Controller  ->  Service  ->  Repository  ->  Prisma  ->  PostgreSQL
```

| Layer | Responsibility |
|---|---|
| **Route** | Path and middleware order (`requireAuth`, `requireRole`, `validate`). |
| **Controller** | HTTP only: read request, call one service, send response. |
| **Service** | Business rules, permissions, tenant scoping, hashing, transactions. |
| **Repository** | Every Prisma query, as explicit named methods. |

**Only repositories and `src/config/` may import the Prisma client.** Services never call Prisma
directly. There is one shared client in `src/config/prisma.js`.

**Tenant rule:** the company is always taken from the authenticated user (`req.user.companyId`),
never from request body, query or params. A record belonging to another company returns 404.

Full details, including how to add a module: [docs/architecture.md](docs/architecture.md).

---

## 1. Requirements

| Tool | Version |
|---|---|
| Node.js | 20 or newer (`node -v`) |
| PostgreSQL | 14 or newer, running locally |
| npm | 9 or newer |

No Docker, Redis or message broker is needed.

## 2. Installation

```bash
git clone <repository-url>
cd pharma-erp-backend
npm install
```

## 3. Environment variables

```bash
cp .env.example .env
```

Then edit `.env`:

| Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | no | `development`, `test` or `production`. Default `development`. |
| `PORT` | no | Port the API listens on. Default `4000`. |
| `DATABASE_URL` | **yes** | PostgreSQL connection string. |
| `JWT_SECRET` | **yes** | At least 32 characters. Used to sign tokens. |
| `JWT_EXPIRES_IN` | no | Token lifetime, e.g. `1d`, `12h`. Default `1d`. |
| `ADMIN_EMAIL` | seed only | Email of the admin user created by the seed. |
| `ADMIN_PASSWORD` | seed only | Password for that admin user (minimum 8 characters). |
| `ADMIN_NAME` | no | Display name for the admin. Default `Administrator`. |
| `ADMIN_COMPANY_NAME` | no | Company created by the seed. Default `Default Company`. |
| `CORS_ORIGIN` | no | `*`, or a comma-separated list of allowed origins. |
| `LOG_LEVEL` | no | `debug`, `info`, `warn` or `error`. Default `info`. |
| `PLATFORM_ADMIN_EMAIL` | seed only | The platform operator's own superadmin (`npm run seed:platform`). Separate from `ADMIN_EMAIL`, which seeds a SHOP. |
| `PLATFORM_ADMIN_PASSWORD` | seed only | Password for that account (minimum 8 characters). |
| `PLATFORM_ADMIN_NAME` | no | Display name. Default `Platform Administrator`. |
| `LLAMA_API_KEY` | no | **Server secret.** Enables AI bill reading. Without it, bill upload reports plainly that automatic reading is not set up and everything else works unchanged. |
| `LLAMA_BASE_URL` | no | Default `https://api.llama.com/v1`. |
| `LLAMA_MODEL` | no | Default `Llama-4-Maverick-17B-128E-Instruct-FP8`. |
| `LLAMA_TIMEOUT_MS` | no | Default `60000`. |
| `BILL_STORAGE_DIR` | no | Where uploaded bills are written. Default `./storage/bills`. Put it outside the repo in production. |
| `BILL_MAX_FILE_SIZE` | no | Largest bill accepted, in bytes. Default `10485760` (10 MB). |

Generate a JWT secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

The app validates all of these at startup and exits with a clear message if something is
missing or invalid. **Never commit `.env`** — it is git-ignored.

> **`LLAMA_API_KEY` is a server-side secret.** It is read once in `src/config/env.js`,
> used only when calling the model, and never reaches a browser. Do **not** copy it into
> any `NEXT_PUBLIC_*` variable in either frontend — anything with that prefix is compiled
> into JavaScript that every visitor can read.

## 4. PostgreSQL setup

Create the development database (and a separate one for tests):

```bash
createdb pharma_erp
createdb pharma_erp_test
```

If `createdb` is not on your PATH (common on Windows), use `psql` or pgAdmin:

```sql
CREATE DATABASE pharma_erp;
CREATE DATABASE pharma_erp_test;
```

On Windows the PostgreSQL tools usually live in `C:\Program Files\PostgreSQL\<version>\bin`.

Then set `DATABASE_URL` in `.env`:

```
DATABASE_URL="postgresql://postgres:your-password@localhost:5432/pharma_erp?schema=public"
```

## 5. Prisma setup

Generate the Prisma client (run this after every schema change, and after `npm install`):

```bash
npm run prisma:generate
```

## 6. Migration

Create and apply migrations in development:

```bash
npm run prisma:migrate
```

In production, apply existing migrations without generating new ones:

```bash
npm run prisma:deploy
```

`prisma migrate dev` is interactive and will refuse to run in CI or any non-interactive shell.
There, generate the SQL first and then deploy it:

```bash
mkdir -p prisma/migrations/$(date +%Y%m%d%H%M%S)_your_change_name
npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/<folder>/migration.sql
npx prisma migrate deploy
```

Inspect the data in a browser:

```bash
npm run prisma:studio
```

## 7. Admin seed

Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env` first, then:

```bash
npm run prisma:seed
```

This creates one company and one `ADMIN` user, with the password hashed using Argon2.
It is safe to run repeatedly: if the admin already exists nothing is created and the
existing password is left untouched. Admin credentials are never hardcoded.

## 7b. Platform superadmin seed

`npm run prisma:seed` above creates a SHOP and its admin. The person who runs the
SaaS **platform** is a different account, with a different job:

```bash
npm run seed:platform
```

It reads `PLATFORM_ADMIN_EMAIL` and `PLATFORM_ADMIN_PASSWORD` and creates a user
with `role: PLATFORM_ADMIN` and **no company**. That missing company is what keeps
them out of every shop's books: every shop route derives its tenant from
`req.user.companyId`, and theirs is null.

Without this account nobody can reach the platform console at all &mdash; a shop's
ADMIN correctly holds no platform permission and gets 403 on all of it.

The seed **refuses to promote an existing shop user**. Quietly turning a shop's
admin into a platform administrator would hand them every other business on the
system, so it stops and tells you to pick a different address.

## 8. Running the development server

```bash
npm run dev     # restarts on file changes
npm start       # plain start, for production
```

Check that it works:

```bash
curl http://localhost:4000/api/v1/health
```

## 9. Running tests

Tests run against a **separate database** so your development data is never touched.

```bash
cp .env.test.example .env.test          # then set DATABASE_URL to pharma_erp_test
npx prisma migrate deploy               # apply the schema to the test database
npm test                                # run once
npm run test:watch                      # re-run on change
```

To apply migrations to the test database on Windows PowerShell:

```powershell
$env:DATABASE_URL="postgresql://postgres:your-password@localhost:5432/pharma_erp_test?schema=public"
npx prisma migrate deploy
```

Unit tests live in `tests/unit/`, API tests in `tests/integration/`. Integration tests use a
real database rather than a mocked Prisma client, and they delete all rows before and after
each file — never point `.env.test` at a database you care about.

## 10. API base URL

```
http://localhost:4000/api/v1
```

Endpoints are documented in [docs/api.md](docs/api.md).

| Method | Endpoint | Auth | Role |
|---|---|---|---|
| GET | `/api/v1/health` | no | – |
| GET | `/api/v1/health/db` | no | – |
| POST | `/api/v1/auth/login` | no | – |
| GET | `/api/v1/auth/me` | yes | any |
| GET | `/api/v1/users` | yes | ADMIN |
| GET | `/api/v1/users/:id` | yes | ADMIN |
| POST | `/api/v1/users` | yes | ADMIN |
| PATCH | `/api/v1/users/:id` | yes | ADMIN |
| PATCH | `/api/v1/users/:id/status` | yes | ADMIN |
| GET | `/api/v1/companies/me` | yes | any |
| GET | `/api/v1/companies/:id` | yes | ADMIN |
| POST | `/api/v1/companies` | yes | ADMIN |
| PATCH | `/api/v1/companies/:id` | yes | ADMIN |
| GET | `/api/v1/company-settings` | yes | any |
| PATCH | `/api/v1/company-settings` | yes | ADMIN |
| GET | `/api/v1/categories` `/units` `/taxes` `/warehouses` `/products` `/suppliers` `/customers` | yes | any |
| GET | the same seven resources, `/:id` | yes | any |
| POST | the same seven resources | yes | ADMIN |
| PATCH | the same seven resources, `/:id` and `/:id/status` | yes | ADMIN |
| GET | `/api/v1/inventory` | yes | any |
| GET | `/api/v1/inventory/:productId/:warehouseId` | yes | any |
| GET | `/api/v1/inventory/movements` | yes | any |
| GET | `/api/v1/inventory/movements/:id` | yes | any |
| POST | `/api/v1/inventory/opening-stock` | yes | ADMIN |
| POST | `/api/v1/inventory/adjustments` | yes | ADMIN |
| GET | `/api/v1/purchases` | yes | any |
| GET | `/api/v1/purchases/:id` | yes | any |
| POST | `/api/v1/purchases` | yes | ADMIN |
| PATCH | `/api/v1/purchases/:id` | yes | ADMIN |
| POST | `/api/v1/purchases/:id/post` | yes | ADMIN |
| POST | `/api/v1/purchases/:id/cancel` | yes | ADMIN |
| GET | `/api/v1/purchase-returns` | yes | any |
| GET | `/api/v1/purchase-returns/:id` | yes | any |
| GET | `/api/v1/purchase-returns/returnable/:purchaseId` | yes | any |
| POST | `/api/v1/purchase-returns` | yes | any |
| PATCH | `/api/v1/purchase-returns/:id` | yes | any |
| POST | `/api/v1/purchase-returns/:id/post` | yes | ADMIN |
| POST | `/api/v1/purchase-returns/:id/cancel` | yes | ADMIN |
| GET | `/api/v1/supplier-payables` | yes | any |
| GET | `/api/v1/supplier-payables/:id` | yes | any |
| GET | `/api/v1/suppliers/:supplierId/ledger` | yes | any |
| GET | `/api/v1/suppliers/:supplierId/outstanding` | yes | any |
| GET | `/api/v1/suppliers/:supplierId/payables` | yes | any |
| GET | `/api/v1/supplier-payments` | yes | any |
| GET | `/api/v1/supplier-payments/:id` | yes | any |
| POST | `/api/v1/supplier-payments` | yes | ADMIN |
| PATCH | `/api/v1/supplier-payments/:id` | yes | ADMIN |
| POST | `/api/v1/supplier-payments/:id/post` | yes | ADMIN |
| POST | `/api/v1/supplier-payments/:id/cancel` | yes | ADMIN |
| GET | `/api/v1/sales` | yes | any |
| GET | `/api/v1/sales/:id` | yes | any |
| POST | `/api/v1/sales` | yes | any |
| PATCH | `/api/v1/sales/:id` | yes | any |
| POST | `/api/v1/sales/:id/post` | yes | ADMIN |
| POST | `/api/v1/sales/:id/cancel` | yes | ADMIN |
| GET | `/api/v1/customer-receivables` | yes | any |
| GET | `/api/v1/customer-receivables/:id` | yes | any |
| GET | `/api/v1/customers/:id/ledger` | yes | any |
| GET | `/api/v1/customers/:id/outstanding` | yes | any |
| GET | `/api/v1/customers/:id/receivables` | yes | any |
| GET | `/api/v1/customers/:id/payments` | yes | any |
| GET | `/api/v1/customer-payments` | yes | any |
| GET | `/api/v1/customer-payments/:id` | yes | any |
| POST | `/api/v1/customer-payments` | yes | ADMIN |
| PATCH | `/api/v1/customer-payments/:id` | yes | ADMIN |
| POST | `/api/v1/customer-payments/:id/post` | yes | ADMIN |
| POST | `/api/v1/customer-payments/:id/cancel` | yes | ADMIN |
| GET | `/api/v1/sales-returns` | yes | any |
| GET | `/api/v1/sales-returns/:id` | yes | any |
| GET | `/api/v1/sales-returns/returnable/:salesInvoiceId` | yes | any |
| POST | `/api/v1/sales-returns` | yes | any |
| PATCH | `/api/v1/sales-returns/:id` | yes | any |
| POST | `/api/v1/sales-returns/:id/post` | yes | ADMIN |
| POST | `/api/v1/sales-returns/:id/cancel` | yes | ADMIN |
| GET | `/api/v1/accounts` | yes | any |
| GET | `/api/v1/accounts/:id` | yes | any |
| GET | `/api/v1/accounts/:id/ledger` | yes | any |
| POST | `/api/v1/accounts` | yes | ADMIN |
| PATCH | `/api/v1/accounts/:id` | yes | ADMIN |
| DELETE | `/api/v1/accounts/:id` | yes | ADMIN |
| GET | `/api/v1/journal-entries` | yes | any |
| GET | `/api/v1/journal-entries/:id` | yes | any |
| GET | `/api/v1/journal-entries/source/:sourceType/:sourceId` | yes | any |
| POST | `/api/v1/journal-entries/:id/reverse` | yes | ADMIN |
| GET | `/api/v1/general-ledger` | yes | any |
| GET | `/api/v1/general-ledger/summary` | yes | any |
| GET | `/api/v1/accounting/trial-balance` | yes | any |
| GET | `/api/v1/accounting/profit-loss` | yes | any |
| GET | `/api/v1/accounting/balance-sheet` | yes | any |
| GET | `/api/v1/tax/profile` | yes | any |
| PATCH | `/api/v1/tax/profile` | yes | ADMIN |
| POST | `/api/v1/tax/validate-gstin` | yes | any |
| GET | `/api/v1/tax/states` | yes | any |
| GET | `/api/v1/tax/classifications` | yes | any |
| GET | `/api/v1/tax/classifications/:id` | yes | any |
| POST | `/api/v1/tax/classifications` | yes | ADMIN |
| PATCH | `/api/v1/tax/classifications/:id` | yes | ADMIN |
| GET | `/api/v1/tax/gst-summary` | yes | any |
| GET | `/api/v1/tax/input-tax` | yes | any |
| GET | `/api/v1/tax/output-tax` | yes | any |
| GET | `/api/v1/tax/gst-purchases` | yes | any |
| GET | `/api/v1/tax/gst-sales` | yes | any |
| GET | `/api/v1/tax/lines/:source` | yes | any |
| GET | `/api/v1/tax/hsn-summary/:source` | yes | any |
| GET | `/api/v1/tax/returns/gstr-1` | yes | any |
| GET | `/api/v1/tax/returns/gstr-3b` | yes | any |
| GET | `/api/v1/tax/returns/reconciliation` | yes | any |
| GET | `/api/v1/dashboard` | yes | any |
| GET | `/api/v1/reports/sales` | yes | any |
| GET | `/api/v1/reports/purchases` | yes | any |
| GET | `/api/v1/reports/customer-outstanding` | yes | any |
| GET | `/api/v1/reports/supplier-outstanding` | yes | any |
| GET | `/api/v1/reports/customer-ledger/:id` | yes | any |
| GET | `/api/v1/reports/supplier-ledger/:id` | yes | any |
| GET | `/api/v1/reports/payments-received` | yes | any |
| GET | `/api/v1/reports/supplier-payments` | yes | any |
| GET | `/api/v1/expenses` | yes | any |
| GET | `/api/v1/expenses/categories` | yes | any |
| GET | `/api/v1/expenses/:id` | yes | any |
| POST | `/api/v1/expenses` | yes | any |
| PATCH | `/api/v1/expenses/:id` | yes | any |
| POST | `/api/v1/expenses/:id/post` | yes | ADMIN |
| POST | `/api/v1/expenses/:id/cancel` | yes | ADMIN |
| POST | `/api/v1/expenses/:id/reverse` | yes | ADMIN |
| GET | `/api/v1/reports/expenses` | yes | any |
| GET | `/api/v1/reports/inventory-valuation` | yes | any |
| GET | `/api/v1/reports/profit-loss` | yes | any |
| GET | `/api/v1/reports/general-ledger` | yes | any |
| GET | `/api/v1/reports/cash-bank` | yes | any |
| GET | `/api/v1/credit` | yes | any |
| GET | `/api/v1/credit/receivables` | yes | any |
| GET | `/api/v1/credit/payables` | yes | any |
| GET | `/api/v1/opening-balances` | yes | any |
| GET | `/api/v1/opening-balances/details` | yes | any |
| POST | `/api/v1/opening-balances` | yes | ADMIN |
| GET | `/api/v1/accounting-periods` | yes | any |
| GET | `/api/v1/accounting-periods/check` | yes | any |
| GET | `/api/v1/accounting-periods/:id` | yes | any |
| GET | `/api/v1/accounting-periods/:id/verify` | yes | any |
| POST | `/api/v1/accounting-periods` | yes | ADMIN |
| POST | `/api/v1/accounting-periods/:id/close` | yes | ADMIN |
| POST | `/api/v1/accounting-periods/:id/reopen` | yes | ADMIN |
| GET | `/api/v1/credit/collections` | yes | any |
| GET | `/api/v1/credit/payables-summary` | yes | any |
| GET | `/api/v1/credit/exposure` | yes | any |
| GET | `/api/v1/customers/:id/credit` | yes | any |
| GET | `/api/v1/customers/:id/statement` | yes | any |
| GET | `/api/v1/suppliers/:id/statement` | yes | any |
| GET | `/api/v1/credit/customers/:id` | yes | any |
| GET | `/api/v1/credit/suppliers/:id` | yes | any |

---

## Project structure

```
src/
├── config/          env validation, Prisma client, transaction helper
├── middlewares/     require-auth, require-role, validate, error-handler
├── modules/         one folder per feature
│   ├── auth/        routes · controller · service · repository · validation
│   ├── users/       routes · controller · service · repository · validation
│   ├── companies/   routes · controller · service · repository · validation · company-defaults
│   ├── company-settings/
│   ├── categories/  units/  taxes/  warehouses/
│   ├── products/    suppliers/  customers/
│   ├── inventory/   balances + immutable stock movement ledger
│   ├── purchases/  draft -> post, calculator, reuses the inventory service
│   ├── purchase-returns/  references a posted purchase, returns stock at its original cost
│   ├── supplier-payables/  payable per bill + immutable supplier ledger
│   ├── supplier-payments/  payments with allocation across bills
│   ├── sales/           draft -> post, calculator, stock out + frozen COGS
│   ├── customer-receivables/  receivable per invoice + immutable customer ledger
│   ├── customer-payments/     receipts with allocation across invoices
│   ├── sales-returns/   credit notes; stock back at the frozen COGS cost
│   ├── opening-balances/  bring an existing business's books in, once
│   ├── periods/        accounting periods and the closed-period posting lock
│   ├── credit/         credit limits and terms, statements, ageing, collections
│   ├── expenses/       rent, salaries and the rest; draft -> post -> immutable
│   ├── accounting/     chart of accounts, journal, GL posting, statements
│   ├── tax/            GST: GSTIN, HSN/SAC, place of supply, tax summaries
│   ├── reports/        dashboard, business reports, the credit book
│   ├── document-numbers/  company-scoped counters (PUR-2026-000001), no HTTP surface
│   └── health/      routes · repository
├── utils/           logger, ApiError, response helpers, pagination, validation, money helpers
├── app.js           Express app (no listen — used by tests too)
└── server.js        starts the server
prisma/
├── schema.prisma
├── migrations/
└── seed-admin.js
tests/
├── unit/
├── integration/
└── helpers/
docs/
├── api.md
└── architecture.md
```

## Implemented modules

| Module | Status |
|---|---|
| `auth` | Login, current user. Argon2 hashing, JWT. |
| `users` | List (paginated, searchable), read, create, update, activate/deactivate. ADMIN only, company-scoped. |
| `companies` | Read own company, update own company, create a new company with its first admin. |
| `health` | Liveness and database readiness. |
| `categories` | Product categories. Name unique per company. |
| `units` | Units of measure (PCS, KG, ...). Name and short code unique per company. No conversion logic. |
| `taxes` | Tax master (GST slabs). Rate only - no GST calculation engine yet. |
| `warehouses` | Warehouse master data. No stock quantities. |
| `products` | Products with category, unit and optional tax. Decimal pricing. **No stock field.** |
| `suppliers` | Supplier master with opening balance and credit limit. No payable ledger yet. |
| `customers` | Customer master, same shape as suppliers. No receivable ledger yet. |
| `company-settings` | One row per company: currency, timezone, date format, prefixes, financial year. |
| `inventory` | Stock per product per warehouse, immutable movement ledger, opening stock, adjustments, moving weighted average costing. |
| `purchases` | Supplier bills. Drafts (no stock effect) -> posting (stock in, permanent). Discounts, tax, snapshots, document numbering. |
| `purchase-returns` | Goods sent back to a supplier. References a posted purchase, removes stock at the original purchase cost, supports partial returns. |
| `supplier-payables` | Payable per posted purchase, plus an immutable supplier ledger and outstanding/balance views. Read-only over HTTP. |
| `supplier-payments` | Payments to suppliers, allocated across bills. Drafts settle nothing; posting moves balances. |
| `sales` | Sales invoices. Drafts (no stock effect) -> posting (stock out, COGS frozen at the moving average, receivable raised). |
| `customer-receivables` | Receivable per posted invoice, plus an immutable customer ledger and outstanding/balance views. Read-only over HTTP. |
| `customer-payments` | Money received from customers, allocated across invoices. Unallocated remainder is customer credit. |
| `sales-returns` | Credit notes. References a posted invoice, returns stock at the frozen COGS cost, credits the receivable. |
| `opening-balances` | How a business already trading starts here: cash, bank, customer dues, supplier dues, stock, and any other asset/liability/equity it already holds, as one balanced journal entry against Owner's Capital. The debit/credit side of an 'other' balance is derived from the account type, and revenue/expense accounts are refused so an initialization can never manufacture profit. No fake invoices, no second valuation, once per company enforced by the database. |
| `periods` | Accounting periods and the posting lock. Closing a period refuses new postings dated inside it, checked at the single point every journal entry passes through. Closing first VERIFIES the period reconciles - the period balances, the ledger balances, and both sub-ledgers agree with their control accounts - and refuses a period that does not. The same checks are readable read-only before committing. |
| `credit` | Credit limits and terms, party statements, ageing and the collection list. Enforces the limit inside sales posting under a customer row lock. Adds no financial fact: every figure is read from the sub-ledgers that already maintain it. |
| `expenses` | Rent, electricity, salaries and the rest. DRAFT -> POSTED -> immutable, with reversal. Categories are EXPENSE accounts, so the expense report, the P&L and the general ledger are the same rows. No GST fields at all. |
| `accounting` | Chart of accounts, append-only double-entry journal, GL posting for every document type, account ledgers, trial balance, P&L and balance sheet. |
| `tax` | GST: company registration and GSTIN validation, HSN/SAC classification, the CGST/SGST/IGST calculator, place-of-supply rules, input/output tax summaries that reconcile to the ledger, and GSTR-1 / GSTR-3B **preparation datasets** with their own reconciliation. Read-only; nothing is filed. |
| `reports` | The business dashboard, thirteen reports and the credit book. Read-only, works with GST switched off, and delegates every calculation to the module that owns it rather than recomputing. |
| `platform` | The SaaS business: admin-configurable subscription plans, the sales team and their permissions, shop onboarding in one transaction, subscriptions with sale-time snapshots, the collections ledger, and manual admin recharges/grants with a full audit trail and no payment gateway. Touches no accounting table — subscription money is the platform operator's revenue and never enters a shop's journal. Also holds the guard that stops an expired shop posting. |
| `bills` | AI bill import. Upload a photo or PDF, a model reads it, a human checks it, and confirming posts it **through the existing purchase and sales services** — so an imported bill and a typed one produce identical accounting. AI output is never posted directly. Entirely optional: with no API key the feature says so and nothing else changes. |

## Current limitations

- **A SHOP's roles are still an enum (`ADMIN`, `STAFF`), not database tables.** That remains the
  right shape for a shop: the only distinction that matters is who may post. The PLATFORM side now
  does have granular permissions — a flat `String[]` on the user, checked by `requirePermission()` —
  because what a field rep is trusted to do varies by person. It is deliberately not a
  general-purpose RBAC engine: no role table, no permission table, no inheritance.
- **One user belongs to at most one company.** Deliberate MVP choice; multi-company access would
  need a join table and a token/context change. Platform staff are the one exception and have
  `companyId = null`, which is precisely what keeps them out of every shop's books.
- **`POST /api/v1/companies` can still be called by any shop ADMIN.** The SaaS onboarding route
  (`POST /api/v1/businesses/onboard`) is correctly gated on `BUSINESS_CREATE`, but this older
  endpoint predates the platform roles and was left as it was rather than changed underneath
  existing callers. Restrict it before exposing the API publicly.
- **No refresh tokens.** When a JWT expires the user logs in again.
- No registration, password reset, email verification, 2FA or invitations.
- No audit log yet, though every write goes through a service that knows the actor and tenant, so
  audit records can be added there later.
- **A posted sales return cannot be undone**, and there is no refund document: if a
  customer had already paid, a return leaves customer credit visible in the balance with
  no way to pay it back yet.
- **Returned goods are accepted back unconditionally** — no damaged/saleable distinction
  and no quarantine location.
- **COGS is frozen at the moving average at posting time.** That is correct for weighted
  average costing, but it means a back-dated purchase does not retro-adjust the margin on
  invoices already posted.
- **A posted purchase can never be edited or cancelled.** Corrections are made with a
  purchase return, which reverses stock as its own auditable document.
- **A posted purchase return cannot be undone either.** Reversing one would put back stock
  that may already have been consumed; a mistaken return currently needs a manual stock
  adjustment.
- **Returns reverse cost only, not tax.** `grandTotal` is quantity x original unit cost;
  no input-tax reversal and no supplier debit note exist yet.
- **Returning at the original cost while the average has moved leaves a valuation
  residue.** The GL now has an account for it (`5100` Inventory Valuation Adjustment)
  and a test that measures it exactly, but a purchase return does not yet post the
  difference there — so the Inventory control account can exceed the stock ledger's
  valuation by that residue. Inventory quantity and average stay correct; the ledger
  still balances. See docs/architecture.md.
- **Purchase numbers are allocated at draft creation**, so a cancelled draft leaves a gap
  in the series. Acceptable for an internal document; sales invoices will need a stricter
  rule.
- **The sub-ledgers and the general ledger are separate books, by design.** Payables and
  receivables answer "who owes what"; the GL answers "is the business profitable". The AP
  and AR control accounts are tested to reconcile with their sub-ledgers.
  `Supplier.openingBalance` is still never modified.
- **A posted payment cannot be edited, cancelled or reversed.** A mistake currently has
  no undo.
- **An existing supplier advance cannot be applied to a later bill.** Advances are
  created and visible, but allocating one afterwards needs an endpoint that mutates a
  posted payment, which was left out deliberately. Allocate at payment time.
- **Products still carry no stock column.** Stock lives in `InventoryBalance`, per warehouse.
- **No stock transfers between warehouses**, no batch/expiry tracking, no serial numbers,
  no stock reservations and no low-stock alerts (`reorderLevel` is stored but unused).
- **Average cost is stored at 4 decimal places**, so `quantity x averageCost` can differ from
  the amount actually paid by a fraction of a rupee. That residue is inherent to weighted
  average costing.
- **The party `openingBalance` column is still recorded but not posted.** It predates the
  opening-balance feature and is superseded by it: use `POST /api/v1/opening-balances`,
  which posts through the general ledger and raises real receivables and payables. The old
  column is left in place rather than removed, so no existing data is lost.
- **Opening balances cannot be edited or re-run.** They are an initialization, and this
  system corrects history with a new entry rather than by editing an old one. A wrong
  opening balance is corrected today by a journal reversal plus manual adjustment; a
  dedicated correction flow is not built.
- **No manual journal entries.** Every entry comes from a document, which is what makes
  posted accounting records impossible for a user to manipulate — but depreciation,
  accruals, payroll and bank charges have nowhere to go yet.
- **Accounting periods are OPT-IN, and an absent period does not block.** A closed period
  refuses new postings dated inside it; a date in no period is allowed, because no company
  created before periods existed has one and refusing would have stopped every business
  trading. A company that wants the strict rule sets `requireOpenPeriod` on its settings
  row (not yet exposed through a settings endpoint).
- **Closing writes no closing entry.** Retained earnings are still computed rather than
  posted, and there is no financial-year rollover. Closing refuses new postings; it does
  not restate the books, because they already balance.
- **A period cannot be edited**, only reopened — with a reason, and attributed. Closing the
  wrong month is a mistake a person will make, so reopening exists rather than being
  impossible.
- **Impossible calendar dates are refused only by the new schemas.** `2026-02-30` is
  rejected by the period and opening-balance endpoints, which validate a date by round
  trip. The older document schemas still roll it forward into March — a pre-existing gap
  left untouched rather than changed across eight modules.
- **Accounting reports are flat.** Accounts are grouped by type, not rolled up through
  `parentId`. The hierarchy is stored and validated but not yet summarised.
- **A journal reversal deliberately un-balances the GL against the sub-ledger**, because it
  reverses the journal without reversing the document that caused it. It exists for
  corrections and no document flow uses it.
- **Expenses are paid, never owed.** An expense is recorded as already settled, by cash or
  by bank; there is no "bill received, pay later" expense. `SupplierPayable` carries a
  **required** foreign key to a purchase, and the supplier ledger, the ageing report, the
  credit book and the payment-allocation logic all read `payable.purchase` and assume it
  exists. Supporting credit expenses means making that nullable, adding an `expenseId`
  beside it and revisiting every one of those readers - larger than one phase, and a
  partial version would break working credit reporting. An expense's `supplierId` is
  therefore informational: it records who was paid and raises nothing.
- **No input tax credit on expenses.** An expense carries no tax fields whatsoever, so
  nothing reaches GSTR-3B. Claiming ITC needs a tax-bearing expense line, a supplier
  GSTIN, an HSN/SAC code and a place of supply - the full purchase apparatus. Until that
  exists, a tax-bearing expense would produce a *wrong* return rather than an incomplete
  one.
- **No recurring expenses, approvals, attachments, budgets or cost centres**, and no petty
  cash float. An expense is one date, one category, one amount and where the money left
  from.
- **A credit limit of `0` means UNLIMITED, and "no credit at all" cannot be expressed.**
  Zero is the schema default every customer already carries, so reading it as "no credit"
  would refuse every sale ever made. The consequence is that a business cannot say "this
  customer gets no credit" - that needs either a nullable `creditLimit` (a destructive
  change to live data) or a separate policy flag, and neither was invented here.
- **Supplier credit limits are reported but never enforced.** Refusing to record a bill a
  supplier has already sent would not stop the liability, it would only hide it. The
  asymmetry with customers is deliberate.
- **The credit limit is checked when an invoice is POSTED, not when it is drafted.** A
  draft can be prepared for any amount. A client that wants to warn earlier can read
  `GET /customers/:id/credit` and compare against `availableCredit`.
- **An undated document is outstanding but never overdue.** Nobody agreed a date, so
  nothing has been missed. Undated amounts are reported separately rather than hidden.
  Setting `creditDays` on a party stops new documents being undated; it does not
  backfill existing ones.
- **No credit-limit history.** Changing a limit changes it; there is no record of what it
  was. Only the override decision is audited, with who, why and what was owed at the time.
- **No dunning, late-fee interest, credit scoring, write-offs or promise-to-pay tracking**,
  and no statement delivery by email or PDF.
- **No cash-flow statement, no trend series, and no PDF or Excel export.** Every report
  returns structured JSON; the cash and bank report shows movements and balances rather
  than a classified cash-flow statement.
- **The credit book's `asOfDate` defaults to the server's UTC date**, while the dashboard
  resolves the company's own timezone. Pass `asOfDate` explicitly for exactness near
  midnight.
- **GST is opt-in per company.** Setting a `stateCode` on the GST profile turns it on;
  until then tax behaves exactly as it did before the GST phase, posting a single amount to
  the aggregate tax accounts. That is deliberate: without your own state there is no way to
  tell an intra-state supply from an inter-state one, and guessing would charge the wrong
  tax. Once GST is on, a document whose counterparty state is unknown is refused.
- **No GST portal integration and no filing.** GSTR-1 and GSTR-3B **preparation
  datasets** are built from posted documents, but nothing is submitted anywhere, no
  offline-utility JSON is produced, and there is no e-invoice IRN or e-way bill. Every
  response says so in a `notFiled` field; `netTax` is not a legal liability.
- **The prepared datasets do not carry every statutory field.** The B2CL/B2CS split needs
  a value threshold this system does not store; amendment tables (9A/9C) and advances
  (11A/11B) are not produced; the HSN table has no unit of measure or quantity. Each gap
  is stated in the dataset rather than filled with a guess.
- **Input tax credit is a single bucket.** Imports, reverse charge, ISD, blocked credits
  under section 17(5) and rule 42/43 reversals are each reported as *not determined*,
  with a reason, rather than assumed to be zero.
- **A prepared return is not stored.** There is no snapshot of "what was filed", so
  re-running a period after a back-dated document legitimately gives a different answer.
- **Supplier and customer GSTINs are validated for format only**, not checksum. Tightening
  them would retroactively invalidate GSTINs stored by earlier phases. The strict check
  (structure, state code and checksum) is available at `POST /api/v1/tax/validate-gstin`
  and is enforced on the company's own GSTIN.
- **A valid GSTIN checksum is not a registration.** Nothing here contacts the GST portal.
- **All prices are tax-exclusive.** Tax-inclusive price lists are not supported; the reverse
  arithmetic exists and is tested, but no document uses it.
- **Reverse charge, the composition scheme and SEZ/export workflows are not modelled.**
  The registration type and a `ZERO_RATED` treatment are recorded, but neither changes how
  tax is computed.
- **Cess is a single percentage rate**, not the quantity-based cess some goods attract.
- **A purchase return taxes `quantity x unitCost`** without prorating the original line's
  discount, consistent with the Phase 5 return valuation. Bills without a line discount are
  unaffected.
- **Place of supply follows the goods.** The special place-of-supply rules for services are
  not modelled.
- **Units have no conversion.** 1 KG = 1000 G is not modelled.
- **No DELETE endpoints for master data** - records are deactivated, never removed. See
  docs/architecture.md.

## How to add a new module

1. Create `src/modules/<name>/` with `<name>.routes.js`, `<name>.controller.js`,
   `<name>.service.js`, `<name>.repository.js` and `<name>.validation.js`.
2. Mount it in `src/app.js`: `app.use('/api/v1/<name>', <name>Routes)`.
3. Add tests in `tests/integration/<name>.test.js`.
4. Document the endpoints in `docs/api.md`.

Keep the flow **route → controller → service → Prisma**. Controllers do not contain business
logic or Prisma queries; services do not touch `req` or `res`.

## Conventions for financial modules

These rules are what accounting was built on, and what GST must follow when it is added:

- **Never use JavaScript floating point arithmetic for money.** Use the helpers in
  `src/utils/money.js` and store money columns as Prisma `Decimal`, never `Float`.
- **GST logic belongs in a shared service/utility**, not scattered across controllers.
- **Retail GST-inclusive pricing and B2B GST-exclusive pricing are separate concepts.**
  Do not collapse them into one field.
- **Freeze tax rates on the transaction.** Copy the GST rate onto the invoice line at the time
  of the transaction. A historical invoice must never be recalculated from the product's
  current GST rate.
