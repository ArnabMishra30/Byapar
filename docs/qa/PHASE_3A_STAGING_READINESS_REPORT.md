# Phase 3A — Staging Infrastructure & Concurrency Hardening

**Date:** 2026-10-14
**Inputs:** [QA_AUDIT_REPORT.md](../../QA_AUDIT_REPORT.md) (the brief referenced `docs/qa/SHOP_WEB_E2E_AUDIT.md`, which does not exist — the root report is the source of truth), [PHASE_1_FIX_REPORT.md](PHASE_1_FIX_REPORT.md), [PHASE_2_READINESS_REPORT.md](PHASE_2_READINESS_REPORT.md).
**Scope:** The four staging blockers/gaps — persistent bill storage, production CORS, Prisma drift, and M3/M4 concurrency. **Inventory posting logic is unchanged** (deferred to a later phase, as instructed). No production deployment was performed.
**Honesty note:** All automated tests below were executed this session and pass. **No browser/UI testing and no live S3 or live LlamaExtract (AI) testing were performed** — the S3 provider is covered by mocked unit tests and a startup-config guard, not a live bucket. The staging checklist (§7) marks every live/interactive item accordingly.

---

## 0. Summary

| Item | Change | Mechanism | Tests |
|------|--------|-----------|-------|
| 1. Persistent storage | Pluggable bill-storage provider: `local` (default) or `s3` | S3-compatible object storage via `@aws-sdk/client-s3`; local unchanged | 8 unit (mocked S3 + config guard); existing 66 bill tests on local |
| 2. Production CORS | No wildcard default; explicit allow-list; fail-fast in prod | zod `superRefine` + derived `corsOrigins` + `cors({origin})` | 6 integration (allowed/blocked/preflight + 3 fail-fast) |
| 3. Prisma drift | Schema pinned to match the live DB exactly | `onDelete: Restrict` on 7 FKs + re-declared index; **no migration needed** | verified empty `migrate diff`; fresh-DB deploy |
| 4a. M3 upload concurrency | Atomic duplicate-upload detection | Postgres advisory lock around check+insert | concurrency test: 4 simultaneous → exactly 1 bill |
| 4b. M4 posting concurrency | Atomic duplicate-posting guard | `Bill.postingFingerprint` + `@@unique`, reserved before post | concurrency tests: IN + OUT → exactly 1 document |

Two additive migrations (`bill_checksum` from Phase 1, `bill_posting_fingerprint` new); both verified to apply cleanly on a disposable database with no drift.

---

## 1. Persistent bill-file storage

**Root cause.** Bill files were written only to the local filesystem (`BILL_STORAGE_DIR`), which is ephemeral on Render's default instances — source documents vanish on every redeploy/spin-down (Phase 2 blocker B1).

**Change.** Storage now goes through a pluggable provider chosen by `BILL_STORAGE_PROVIDER`:
- `local` (default) — filesystem, unchanged behaviour; correct for development and for a host with a persistent disk.
- `s3` — any S3-compatible object store (AWS S3, Cloudflare R2, MinIO) via `@aws-sdk/client-s3`; durable across redeploys.

`bill-storage.service.js` keeps everything provider-agnostic (validation, SHA-256 checksum, the tenant-scoped `"<companyId>/<month>/<uuid>.<ext>"` key, and the **company-prefix access check** in `readBill`), and delegates only the bytes to the provider. The same key layout and tenant check apply to both providers, so **tenant isolation is preserved** and one shop can never read or reference another's object. Missing files map to the existing friendly `BILL_FILE_MISSING` (404) for both providers; a failed upload still deletes the stored object so no orphan is left; storage-provider errors other than "not found" propagate and are handled by the error middleware (generic 500, logged). Credentials come only from the environment and never reach a browser.

**Files changed**
- `backend/src/config/env.js` — `BILL_STORAGE_PROVIDER` + `BILL_S3_*` vars; fail-fast when provider is `s3` without bucket/region/credentials.
- `backend/src/modules/bills/storage/local-provider.js` (new) — filesystem `put`/`get`/`remove`, path-escape guard, `notFound` signalling.
- `backend/src/modules/bills/storage/s3-provider.js` (new) — S3 `put`/`get`/`remove`, lazy client, `isNotFoundError` mapping.
- `backend/src/modules/bills/bill-storage.service.js` — delegates to the selected provider; validation/checksum/key/tenant-check unchanged.
- `backend/package.json` — adds `@aws-sdk/client-s3`.
- `backend/.env.example` — documents the new variables (names only).

**Tests:** `backend/tests/unit/bill-storage-s3.test.js` (8) — the S3 provider issues the right bucket+key+content-type on put, returns bytes on get, maps NoSuchKey / 404 to `notFound`, propagates other errors, deletes by key (SDK mocked), and the config guard refuses `s3` without credentials / accepts it with them. The 66 existing bill tests continue to exercise the **local** provider end-to-end.

> Not tested: a live S3/R2 bucket round-trip. Verify on staging (§7).

---

## 2. Production CORS configuration

**Root cause.** `CORS_ORIGIN` defaulted to `*`, and in production that was only a warning — the API would reflect any origin (Phase 2 B2).

**Change.** The wildcard default is gone. `env.js` now:
- leaves `CORS_ORIGIN` optional and, in **development/test**, falls back to explicit localhost origins (`http://localhost:3001/3002`, `http://127.0.0.1:3001/3002`);
- **fails startup in production** (clear zod error) when `CORS_ORIGIN` is missing or contains `*`;
- exposes a derived `corsOrigins` array that `app.js` passes to `cors({ origin })`, so an untrusted origin receives no CORS headers and the browser blocks it. Requests with no `Origin` (server-to-server, tests) are unaffected. The now-redundant runtime warning in `server.js` was removed. Credentialed-request behaviour is unchanged (the first-party proxy means cross-origin credentialed calls are not used); no secrets or cookie contents are logged.

**Files changed:** `backend/src/config/env.js`, `backend/src/app.js`, `backend/src/server.js`, `backend/.env.example`.

**Tests:** `backend/tests/integration/cors.test.js` (6) — an allowed origin gets its `Access-Control-Allow-Origin`; an untrusted origin does not; preflight is answered; and startup is refused in production with no `CORS_ORIGIN` and with `*`, and succeeds with explicit origins (verified by loading `env.js` in a child process).

---

## 3. Prisma schema / migration drift

**Root cause & investigation.** Phase 2 flagged that `prisma migrate dev` wanted to change `onDelete` on seven financial/audit foreign keys and drop one index — a future `migrate dev` could silently ship those changes. On inspection, the schema declares **no explicit `onDelete`** on those relations, so Prisma applied its default for optional relations (`SetNull`), while the live database was created with **`ON DELETE RESTRICT`** (confirmed via `pg_constraint`). The drift was Prisma's implicit default vs the database, **not** a deliberate team decision.

**Decision (documented, not guessed).** `RESTRICT` is the financially-correct, audit-preserving behaviour: it blocks deleting a purchase/invoice/user that a payable, receivable, or audit record points at, and never silently orphans a financial row. So the **intended production schema is the current one**. I made the schema explicit to match the database exactly — `onDelete: Restrict` on the seven relations (`users.companyId`, `supplier_payables.purchaseId`, `sales_invoices.creditLimitOverrideById`, `customer_receivables.salesInvoiceId`, `accounting_periods.closedById`/`reopenedById`, `bills.postedById`) and re-declared `@@index([onboardedById])` on `Company`. This **eliminates the drift with no migration and no change to any delete semantics**, and closes the Phase-2 footgun.

`prisma migrate diff` (live DB → schema) is now **empty**, and `prisma validate` passes. Historical migrations were not edited or rewritten.

> If the team ever actually wants `SetNull` on any of these, that should be a separate, deliberately reviewed migration — not an accident of a framework default. This is noted as the explicit uncertainty the brief asked me to surface rather than guess.

**Files changed:** `backend/prisma/schema.prisma` (seven `onDelete: Restrict` + one `@@index`).

---

## 4. Concurrency hardening (M3 & M4)

### 4a. M3 — duplicate uploads, made atomic

**Race.** The duplicate-upload check was a plain read-then-insert (TOCTOU): N simultaneous identical uploads could all pass the check and each start a (paid) extraction job.

**Fix.** The check and the insert now run inside one transaction holding a Postgres **transaction-scoped advisory lock** keyed on `(companyId, checksum)` (`pg_advisory_xact_lock(hashtext(company), hashtext(checksum))`). Concurrent identical uploads serialise; the loser sees the winner's row and is refused. A plain unique index could **not** be used here because a legitimate multi-invoice file produces several live bills that share one checksum, and `allowDuplicate` must still work — the advisory lock honours both. On any failure the stored object is deleted.

**Files changed:** `backend/src/modules/bills/bill.service.js` (`lockChecksum`, upload wrapped in `withTransaction`).

### 4b. M4 — duplicate posting, made atomic

**Race.** The duplicate-posting guard was a read-only pre-check: two simultaneous confirmations of the same invoice from different bill records could both pass it and both post (worst for auto-numbered sales, where nothing else catches it).

**Fix.** A new nullable `Bill.postingFingerprint` with a `@@unique([companyId, postingFingerprint])` index. The fingerprint is a hash of **file checksum + direction + party + grand total + invoice date** — the same signal as the pre-check, reduced to one value a DB constraint can enforce. It is **reserved before posting**: two concurrent confirms race on the unique index, and the loser is rejected (409 `BILL_DUPLICATE_POSTING`) **before** any document is created. `allowDuplicate` leaves the fingerprint null (Postgres allows many NULLs), so intentional duplicates and un-posted bills never conflict. Because the fingerprint requires the same file **and** the same content, multi-invoice files and genuine reorders (different file) are never falsely blocked; invoice number is deliberately **not** part of it, so blank/differing numbers are handled. Same-invoice-number duplicates remain hard-blocked by the existing document-layer uniqueness. AI extraction still never auto-posts — confirmation posts a human-reviewed payload through the identical purchase/sales services.

**Files changed:** `backend/prisma/schema.prisma` (`postingFingerprint` + unique), `backend/prisma/migrations/20261014060000_bill_posting_fingerprint/`, `backend/src/modules/bills/bill.service.js` (`computePostingFingerprint`, reservation), `backend/src/modules/bills/bill.repository.js` (`reservePostingFingerprint`, `findByPostingFingerprint`).

### Concurrency tests (`backend/tests/integration/bill-duplicate.test.js`)
- **M3:** four simultaneous identical uploads → exactly **one** 201, three 409, and exactly **one** bill row in the database.
- **M4 IN:** two bill records, same supplier+total+date, **different** invoice numbers, confirmed concurrently → exactly one 201 and one 409 `BILL_DUPLICATE_POSTING`; exactly one purchase posted.
- **M4 OUT:** two sales bills from the same file (auto-numbered) confirmed concurrently → exactly one 201 and one 409; exactly one sale posted.
- Retries remain consistent: an `allowDuplicate` override reuses the recorded draft rather than creating a second document.

---

## 5. Migration details & rollback / recovery

**Migrations in this change set** (both additive; no `DROP`/`TRUNCATE`/`DELETE`; nullable columns with no default, so existing rows stay valid):
- `20261014052105_bill_checksum` — `bills.checksum TEXT` + `(companyId, checksum)` index (from Phase 1).
- `20261014060000_bill_posting_fingerprint` — `bills.postingFingerprint TEXT` + `(companyId, postingFingerprint)` **unique** index. Postgres treats NULLs as distinct, so the unique index is satisfied by every existing (NULL) row.

**Item 3 required no migration** — the schema was pinned to the existing database state.

**Verification on a disposable database** (local Postgres; created and dropped): `prisma migrate deploy` applied **all 31 migrations cleanly** (both new ones included), and `prisma migrate diff` against the freshly-migrated database was **empty** (schema matches). Not run against production.

**Rollback / recovery.**
- The migrations are additive, so rolling back **code** is safe without a schema rollback — older code simply ignores `checksum` and `postingFingerprint`. (Follow the existing `DEPLOY_RENDER.md` rollback: redeploy the previous commit on all services.)
- If a schema rollback is ever required, both columns can be dropped with `ALTER TABLE "bills" DROP COLUMN ...` (the unique index drops with its column); no data migration is involved. Prefer leaving the columns in place.
- Production uses `prisma migrate deploy` (apply-only; never resets/drops). Take a Neon branch snapshot before deploying, per the runbook.

---

## 6. Storage & CORS configuration (operator reference)

**CORS (backend / byapar-api).** Set `CORS_ORIGIN` to the comma-separated frontend origins, e.g. `https://byapar-web-staging.onrender.com,https://byapar-admin-staging.onrender.com`. It must not be `*` in production or the service will refuse to start. In local development it may be left unset.

**Bill storage (backend / byapar-api).** Choose one:
- **Persistent disk (no code change):** keep `BILL_STORAGE_PROVIDER=local`, attach a Render disk, set `BILL_STORAGE_DIR=/var/data/bills`. Durable on a single instance.
- **Object storage (recommended for scale):** set `BILL_STORAGE_PROVIDER=s3` and provide `BILL_S3_BUCKET`, `BILL_S3_REGION`, `BILL_S3_ACCESS_KEY_ID`, `BILL_S3_SECRET_ACCESS_KEY`. For Cloudflare R2 / MinIO also set `BILL_S3_ENDPOINT` and (often) `BILL_S3_FORCE_PATH_STYLE=true`. The secret key is a server secret — set it only in the host's environment, never in a committed file. Missing S3 settings fail startup with a clear message.

All variable **names** are documented in `backend/.env.example`; no secret values are committed.

---

## 7. Staging deployment & smoke-test steps

Use a **dedicated staging database and a dedicated test shop**. Never run destructive tests against production.

### Deploy
1. **Isolate:** a new Neon project (or branch) as the staging DB, and a separate `byapar-api-staging` / `byapar-admin-staging` / `byapar-web-staging` trio in one region.
2. **byapar-api-staging** (root `backend`, build `npm ci --include=dev && npx prisma generate`, start `npm run start:render`, health `/api/v1/health`): set `NODE_VERSION=22`, `NODE_ENV=production`, `DATABASE_URL` (Neon direct/unpooled), a fresh `JWT_SECRET`, `TRUST_PROXY=2`, **`CORS_ORIGIN`** = the two staging frontend origins, durable storage (**either** a persistent disk with `BILL_STORAGE_DIR=/var/data/bills`, **or** `BILL_STORAGE_PROVIDER=s3` + the `BILL_S3_*` values), and `LLAMA_API_KEY` to exercise AI import. Deploy; `migrate deploy` applies all migrations to the empty DB.
3. Check `/api/v1/health` and `/api/v1/health/db`.
4. Seed a platform admin from your machine against the staging `DATABASE_URL`; create one test shop + staff.
5. **byapar-admin-staging** / **byapar-web-staging** (`NODE_VERSION=22`, `API_URL=https://<api-staging>/api/v1`). Deploy.

### Smoke tests — status key
**PASS** = verified this session at API/code level · **NOT TESTED** = needs a running staging browser/live provider (not available here) · **BLOCKED** = cannot run until a prerequisite is set.

| # | Check | Status | Basis |
|---|-------|--------|-------|
| 1 | API boots only with a valid `CORS_ORIGIN`; untrusted origin blocked, preflight OK | PASS (API) | `cors.test.js` |
| 2 | Bill upload → file persists in the configured store and is retrievable | NOT TESTED (needs staging + S3/disk) | local path PASS via bill tests; verify durable store on staging, then redeploy and re-open a bill |
| 3 | Duplicate upload refused with reference; `allowDuplicate` keeps both; **4 simultaneous uploads → one bill** | PASS (API) | `bill-duplicate.test.js` incl. concurrency |
| 4 | Duplicate posting blocked; override records; **2 simultaneous confirms (IN & OUT) → one document** | PASS (API) | `bill-duplicate.test.js` incl. concurrency |
| 5 | AI import, printed & handwritten, IN & OUT: upload→review→confirm→post, field-by-field vs source | BLOCKED → NOT TESTED | needs `LLAMA_API_KEY` + durable storage on staging; human verification |
| 6 | Shop login + session persistence (cookies, quiet refresh, logout revokes) | NOT TESTED (browser) | auth verified in code (Phase 2) |
| 7 | Sales/purchases/returns/receipts/payments; dual-role party isolation; inventory & reports | PASS (API) · NOT TESTED (UI) | full backend suite; verify in UI |
| 8 | Mobile + desktop UI, validation, errors, print | NOT TESTED (browser) | business-web typecheck + 225 tests pass |

---

## 8. Verification results (this session)

- **Full backend suite (`npm test`):** 71 files / 1879 tests passed, exit 0 (263s) — up from 69/1863 before this phase (+2 files, +16 tests added here; nothing regressed). The `prisma:error` lines in the log are the intentional concurrency-collision tests, each followed by a pass.
- **business-web typecheck:** PASS (exit 0). **business-web tests:** 19 files / 225 passed (exit 0).
- **Migrations on a disposable DB:** 31/31 applied cleanly; no drift; DB dropped.
- New tests added this phase: `cors.test.js` (6), `bill-storage-s3.test.js` (8), plus M3/M4 concurrency cases in `bill-duplicate.test.js`.

---

## 9. Remaining blockers / notes

1. **Live S3 and live AI import are unverified here** — they require staging infrastructure and a vendor key. Run smoke tests #2 and #5 on staging before trusting them.
2. **Inventory accounting gaps remain open by design** (Phase 2 §2: adjustments/opening-stock post no GL; discount valuation). Deferred to a later phase as instructed; do not treat stock-adjustment reconciliation as correct yet.
3. **`@aws-sdk/client-s3` is now a backend dependency** (used only when `BILL_STORAGE_PROVIDER=s3`; harmless when `local`).
4. **Node:** engines `>=20`, deploy on 22; local dev here is Node 25 (local-only).
5. No production deployment was performed, and no browser/live-provider testing was claimed.
