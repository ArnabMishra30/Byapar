# byapar-clone

Vyapar-style multi-tenant SaaS billing/accounting app for Indian shops (GST, inventory, credit, GL, AI bill import).
Three independent packages (no npm workspaces; each has its own lockfile):
- `backend/`: Express 5 + Prisma 6 + PostgreSQL (Neon), plain JS ESM, Node >=20, port 4000
- `frontend/`: **platform/operator console** (PLATFORM_ADMIN, SALES_STAFF), Next 14 App Router + TS, port 3001. Its shop screens are stubs.
- `business-web/`: **shop app** (ADMIN = "Shop Owner", STAFF) + public landing, Next 14 App Router + TS, port 3002

Context synced at: 638b877 (2026-09-26; auth moved to httpOnly cookies + refresh tokens 2026-09-28, uncommitted)

## Commands
- Root forwards via `--prefix`: `npm run dev:backend | dev:admin | dev:business`, `npm test` (all three), `build:admin`, `build:business`
- backend: `dev` (node --watch), `test` (vitest + supertest, real test DB from `backend/.env.test`, serial, 20s timeout), `prisma:generate|migrate|deploy|studio`, `prisma:seed`, `seed:platform[:prod]`, `seed:demo`, `defaults:ensure[:prod]`, `start:render` (= `prisma migrate deploy && node src/server.js`)
- frontend / business-web: `dev`, `build`, `lint`, `test` (vitest+jsdom); business-web also `typecheck`

## Directory map
- `backend/src/server.js` (listen, graceful shutdown), `src/app.js` (middleware + all route mounts under `/api/v1`)
- `backend/src/config/`: `env.js` (zod env, fail-fast), `prisma.js`, `transaction.js` (`withTransaction`, `withRetryableTransaction`: retries P2002/P2034/40001/40P01)
- `backend/src/middlewares/`: `require-auth.js`, `require-role.js`, `validate.js`, `error-handler.js`
- `backend/src/utils/`: api-error, response (`sendSuccess`/`sendError`), money (Decimal), pagination, validation, logger
- `backend/src/modules/<name>/`: `*.routes → *.controller → *.service → *.repository` + `*.validation` (zod); 31 modules
- `backend/prisma/`: `schema.prisma` (~2100 lines), migrations, seed scripts. `backend/tests/{unit,integration,helpers}`. `backend/docs/{architecture,api}.md`, `backend/PROJECT_PLAN.md`
- `frontend/src/`: `app/(auth)/admin/login`, `app/(dashboard)/{platform,admin,...}`, `lib/api/*` (axios client + per-domain), `lib/auth/`, `features/platform/`, `components/{ui,shared,layout}`
- `business-web/src/`: `app/shop/(app)/*` (thin page wrappers), `features/<domain>/` (real page impls), `lib/api/*` (+ `extended.ts`: registersApi paid/due, creditBookApi, dueListsApi, returns, stockApi, gstReportsApi), `lib/auth/`, `lib/permissions/`, `lib/constants.ts` (APP_CONFIG, ROUTES, DETAIL_ROUTES, NAVIGATION), `components/{ui,shared,layout}`
- business-web routes (all under /shop): dashboard, quick-billing, bills; sales(/invoices,/new,/[id],/[id]/edit,/returns…); purchases(/bills,/new,/[id],/returns…,/payables); stock(/products,/products/[id],/in,/out,/adjustments,/low-stock); customers(/new,/import,/[id]); suppliers; credit-book; money/received|paid; expenses; cash-bank; reports/{sales,purchases,stock,customers,suppliers,expenses,profit-loss,gst}; gst; settings(/staff); profile; subscription; recycle-bin; accounting/*. Old /shop/inventory|credit|money-in|money-out|reports redirect (next.config)
- business-web rules: NAVIGATION lists only backend-backed pages (test 26b checks a page.tsx exists per link; test 27 forbids "soon"); missing backend features are shown in `<NotAvailable>` cards on module pages; money figures only from API (no frontend arithmetic); shared layout: collapsible sidebar sections, Ctrl/Cmd+K command menu (`components/layout/command-menu.tsx`), mobile bottom tab bar; print via `PrintActions` + `data-print-hide`; grid/flex items need `min-w-0` (Card, NativeSelect, DateRangeFilter have it) to avoid 320px overflow

## Backend modules
- Core: auth (login/me), users, companies (`company-defaults.js` seeds new shop), company-settings, health
- Masters: categories, units, taxes, warehouses, products, suppliers, customers
- inventory: `InventoryBalance` + immutable `StockMovement` ledger, moving weighted-average cost, row locks via `$queryRaw`
- Purchasing: purchases (`purchase.calculator.js`), purchase-returns, supplier-payables (+ledger), supplier-payments (allocations)
- Selling: sales (`sales.calculator.js`), sales-returns, customer-receivables (+ledger), customer-payments
- expenses (one balanced JE, no GST)
- accounting: accounts, journal, `gl-posting.service.js` (single GL entry point), `report.service.js` (financial statements), system-accounts
- tax (GST): gst.calculator, gst-context, gstin, state-codes, GSTR-1/3B, reconciliation, HSN/SAC
- reports (dashboard, business, expense, credit book, `period.js`); credit (statements, `credit-limit.service`, collections)
- periods (`period-guard.service` at posting choke point) + opening-balances; document-numbers (`DocumentSequence`, row-locked)
- platform (SaaS): plans, subscriptions, subscription-payments, businesses (onboarding), sales-team, `permissions.js`, `subscription-guard.service`, `public.routes.js`, `subscription-status.routes.js`
- bills (AI import): bill-storage (local disk), `llamacloud.client` (LlamaExtract), bill-extraction, bill-matching, bill-masters, bill-payment, bill.service

## Data model (`backend/prisma/schema.prisma`)
- Tenant root `Company` (1:1 `CompanySettings`); nearly every model has `companyId`
- `User`: role ADMIN | STAFF | PLATFORM_ADMIN | SALES_STAFF, nullable `companyId` (null for platform users), `permissions String[]`
- Masters: Category, Unit, Tax, Warehouse, Product, Supplier, Customer, TaxClassification
- Stock: InventoryBalance (unique product+warehouse), StockMovement
- Purchase side: Purchase/Item, PurchaseReturn/Item, SupplierPayable, SupplierLedgerEntry, SupplierPayment/Allocation
- Sales side: SalesInvoice/Item, SalesReturn/Item, CustomerReceivable, CustomerLedgerEntry, CustomerPayment/Allocation
- GL: Account, JournalEntry/JournalLine, AccountingPeriod; also Expense, DocumentSequence
- SaaS: SubscriptionPlan, Subscription, SubscriptionPayment
- Auth: RefreshToken (userId, tokenHash unique, familyId, expiresAt, revokedAt, replacedById)
- Bill: direction, status, `extraction`/`reviewedData` JSON, unique `storageKey`, unique (companyId, postedSourceType, postedSourceId) prevents double posting
- Document lifecycle: DRAFT → POSTED (immutable) → CANCELLED / returned

## API surface (`/api/v1`, mounted in `backend/src/app.js`)
- Public: `GET /health`, `POST /auth/login|refresh|logout`, `GET /public/plans`. Everything else `router.use(requireAuth)`.
- auth, users, companies, company-settings, masters, inventory
- purchases, purchase-returns, supplier-payables, supplier-payments (ledger/credit also on `/suppliers`)
- sales, sales-returns, customer-receivables, customer-payments (ledger/credit also on `/customers`)
- expenses, accounts, journal-entries, general-ledger, accounting, tax, dashboard, reports, credit, opening-balances, accounting-periods
- SaaS: plans, subscriptions, subscription-payments, businesses, sales-team, my-subscription
- bills: `GET /summary`, `GET /`, `POST /` (multipart `file`), `GET /:id`, `/:id/file`, `/:id/suggestions`, `POST /:id/retry`, `PATCH /:id/review`, `POST /:id/confirm` (ADMIN), `POST /:id/cancel`
- Document pattern: `POST /`, `PATCH /:id`, `POST /:id/post` (ADMIN), `POST /:id/cancel` (ADMIN)

## Auth and authz
- Backend: Bearer JWT (`sub` = user id) in `require-auth.js`; role/companyId/permissions/isActive re-read from DB each request; argon2 passwords
- `require-role.js`: `requireRole('ADMIN')` (maker-checker: STAFF drafts, ADMIN posts/cancels), `requireCompanyAccess` (404 on mismatch), `requirePermission` (PLATFORM_ADMIN passes all; SALES_STAFF by list), `requirePlatform`
- Tenancy: `companyId` always from `req.user`, never request input; repos use `findByIdAndCompany`
- Subscription: `assertSubscriptionAllowsPosting` (402) called from `accounting/journal.service.js`; reads always allowed
- Rate limits: 300/15min on `/api/`, 20/15min on login (skipped in test); `trust proxy` 1 in prod
- Session = httpOnly SameSite=Strict cookies set by `auth.controller.js` via `utils/cookies.js`: `byapar_at` (access JWT, path `/api/v1`) + `byapar_rt` (random refresh token, path `/api/v1/auth`, SHA-256 hash in `RefreshToken`, rotated on each `POST /auth/refresh`, reuse outside 30s grace revokes the family). `POST /auth/logout` revokes. Tokens never in response bodies. `requireAuth` reads the cookie, else a Bearer header (tests/scripts).
- Frontends call same-origin `/api/v1`; `next.config.mjs` rewrites it to the backend (`api-target.mjs`), which keeps cookies first-party (`*.onrender.com` is a public suffix). localStorage holds only a non-secret "signed in" hint. `lib/api/client.ts`: 401 → one shared `/auth/refresh` → retry → else sign out. AuthGuard/nav/`can()` are UX only; backend is the security boundary.
- Dev caveat: cookies ignore port, so admin (3001) and shop (3002) on `localhost` share one session; open one on `127.0.0.1`.

## Key business flows
- Sale post: `backend/src/modules/sales/sales.service.js` `post` → tenant checks → credit limit (`credit/credit-limit.service.js`) → GST (`tax/gst-context.service.js`, `gst.calculator.js`) → stock out (`inventory.service.js`) → receivable → GL (`accounting/gl-posting.service.js`) → doc number; one retryable transaction
- Purchase post: `purchases/purchase.service.js` `post` mirrors it (stock in at WAC → payable → GL). Returns reverse.
- Payments: customer-/supplier-payments allocate against receivables/payables + ledger + GL
- Bill OCR: `POST /bills` stores file → LlamaExtract (upload/job/poll) → validated draft → user reviews with bill-matching suggestions → `confirm` posts via purchase/sales services + `bill-payment.service.js`. No `LLAMA_API_KEY` → 503.
- Periods: period-guard blocks posting into closed periods; opening balances = one balanced JE
- Frontend shop docs: sales/purchases share config-driven module `business-web/src/features/documents/config.ts`

## Config / env (names only)
- backend: NODE_ENV, PORT, DATABASE_URL, JWT_SECRET (≥32 chars), JWT_EXPIRES_IN, ADMIN_EMAIL/PASSWORD/NAME/COMPANY_NAME, PLATFORM_ADMIN_EMAIL/PASSWORD/NAME, CORS_ORIGIN, LOG_LEVEL, DB_TRANSACTION_MAX_WAIT_MS, DB_TRANSACTION_TIMEOUT_MS, LLAMA_API_KEY, LLAMA_BASE_URL, LLAMA_EXTRACT_TIER, LLAMA_PROJECT_ID, LLAMA_TIMEOUT_MS, BILL_STORAGE_DIR, BILL_MAX_FILE_SIZE
- backend also: REFRESH_TOKEN_TTL_DAYS, TRUST_PROXY (hops; 2 on Render behind the frontend proxy); JWT_EXPIRES_IN = access-token life (15m)
- frontend: API_URL (proxy target, must end `/api/v1`, build-time; NEXT_PUBLIC_API_URL still accepted), resolved in `api-target.mjs`
- business-web: API_URL (same), NEXT_PUBLIC_CONTACT_EMAIL, NEXT_PUBLIC_CONTACT_PHONE (build-time)
- Deploy (`DEPLOY_RENDER.md`, manual Render dashboard, no render.yaml/Docker/CI): `byapar-api` (root `backend`, build `npm ci --include=dev && npx prisma generate`, start `npm run start:render`, health `/api/v1/health`), `byapar-admin` (root `frontend`), `byapar-web` (root `business-web`), Node 22. DB = Neon direct/unpooled URL (cold start → raised tx timeouts). Order: API → `seed:platform` from local → admin → web → set CORS_ORIGIN to both origins.

## Conventions
- Backend: kebab-case `module.layer.js`; Express 5 async errors → `error-handler.js` (ApiError, ZodError, P2002→409); response shape `{success, message, data, pagination, errors, code}`
- `validate({body, params, query})` puts parsed data on `req.validated` (read query from there)
- Repositories take optional `tx`; money via Decimal (`utils/money.js`); posted docs immutable; all GL writes via `gl-posting.service.js`
- Frontends: `@/*` → `src/*`, all client components, React Query (server state) + AuthContext; all calls through `lib/api/client.ts`; never rename role enum, map labels in `lib/auth/roles.ts`; GST UI gated on `gstProfile.gstEnabled`; comments explain "why"
- business-web: shop routes live under `/shop`; `/login` redirects to `/shop/login` (next.config)

## Known issues / tech debt
- Bill files on local disk: lost on each Render redeploy (move to S3/R2 in `bill-storage.service.js`)
- No CI; frontend `next.config.mjs` has `eslint.ignoreDuringBuilds: true`
- `frontend/` shop pages (/sales, /purchases, /inventory, ...) are `ModulePlaceholder` stubs; large pages (admin/companies/[id] ~660 lines)
- frontend AuthGuard doesn't block platform roles from shop/admin routes (or vice versa) by URL; UX only
- `frontend` `companyKey` (`byapar_active_company_id`) is dead; `USER_ROLES` label conflicts with `roles.ts`
- `backend/check-users.js` committed: dumps all users to console
- Root `.env`/`.env.test` + root `*.example` duplicate backend ones and are likely unused (backend loads env from its cwd)
- README claims "JavaScript only" (backend only) and points to `docs/` (actually `backend/docs/`); mentions stale `pharma_erp_test`; backend package still named `pharma-erp-backend`
- `CORS_ORIGIN` defaults to `*` (warn-only in prod)
- Platform users (companyId null) on shop read routes not explicitly blocked; worth a check
- Login redirect check in business-web doesn't reject `/\host`
- PROJECT_PLAN LATER: Branch, ProductPrice, StockTransfer, AccountGroup, Notification, audit

## Important files
- `backend/src/app.js`: every route mount and global middleware
- `backend/src/middlewares/require-auth.js`, `require-role.js`: all authz
- `backend/src/config/transaction.js`: transaction/retry semantics for posting
- `backend/src/modules/accounting/gl-posting.service.js`, `journal.service.js`: GL + subscription gate
- `backend/src/modules/sales/sales.service.js`, `purchases/purchase.service.js`: posting pipelines
- `backend/src/modules/bills/bill.service.js`, `llamacloud.client.js`: OCR import
- `backend/prisma/schema.prisma`: data model
- `business-web/src/lib/api/client.ts`, `frontend/src/lib/api/client.ts`: API clients + auth header/401
- `business-web/src/lib/permissions/index.ts`: UX mirror of backend role rules
- `DEPLOY_RENDER.md`: deployment runbook
