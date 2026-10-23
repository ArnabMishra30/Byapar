# Phase 2 — Independent Verification & Production-Readiness Report

**Date:** 2026-10-14
**Inputs:** [QA_AUDIT_REPORT.md](../../QA_AUDIT_REPORT.md) (the Phase-1 brief referenced `docs/qa/SHOP_WEB_E2E_AUDIT.md`, which does not exist — the root report is the source of truth) and [PHASE_1_FIX_REPORT.md](PHASE_1_FIX_REPORT.md).
**Method:** Independent read-only review of the actual working-tree diff, the four fixes, their tests, the inventory/GL posting paths, the deploy runbook, and the auth/storage surfaces. The **full backend suite was executed this session and passes (69 files / 1863 tests, exit 0)**, as were the business-web checks (typecheck + 225 tests). Pre-fix defect reproduction is **reasoned from the code** (the new integration tests would fail against pre-fix code), not re-run against a reverted tree — I can demonstrate that on request.
**Honesty note:** **No browser/UI testing and no live LlamaExtract (AI) testing were performed** — this session has no browser automation and no vendor key. Every interactive/live item in §4 is marked accordingly. Nothing below claims a test that was not run.

---

## 0. Readiness verdict

| Target | Verdict |
|--------|---------|
| **Phase-1 fixes correct (sequential use)** | ✅ Verified — all four, no GL imbalance, no tenant leak |
| **Concurrency-hardened** | ⚠️ Partial — only M2 has a DB-unique backstop; M3/M4 are not race-safe |
| **Staging** | ✅ Ready **once bill storage is made durable** (persistent disk) and `CORS_ORIGIN` is set |
| **Production** | ❌ **Not yet** — 1 hard blocker (ephemeral bill storage) + 2 must-fix (CORS enforcement, FK drift). Inventory accounting gaps should be decided before real books are kept. |

---

## 1. Verification of the Phase-1 fixes

Independently reviewed against the actual diff (9 tracked files, 4 new test files, 1 additive migration). Verdicts and the edge cases found:

| Fix | Verdict | What holds | Residual risk found | Evidence |
|-----|---------|-----------|---------------------|----------|
| **H1** purchase-return discount | **Solid** | Taxable = gross − prorated discount; GST on net; payable + input-GST reversal now correct. `discountAmount` is the whole-line discount, so proration is right. GL **always** balances — `varianceLine` is a plug and the discount reverses the purchase's variance symmetrically (correct sign). Stock reverses at gross `unitCost`, which is correct because inventory was capitalised at gross. | (a) Sum of prorated partials can leave a **sub-0.0001 residue** in the variance account on non-exact divisors (not a GL imbalance). (b) **Stale docstring** "No tax is reversed" directly contradicts the code, which does reverse input tax. (c) Test gaps: no partial-FIXED, IGST/inter-state, or multi-line case. | `purchase-return.service.js:164-184,246-255`; `gl-posting.service.js:85-92,176-213` (stale comment `:172-174`) |
| **M2** transfer idempotency | **Solid (race-safe)** | The `@@unique([companyId,sourceType,sourceId])` index is the real backstop; in-tx recheck + P2002 retry + post-retry catch converge to **one** row and all paths return the same transfer. No half-write (single tx). Frontend key is stable across double-click, cleared on success/reopen, button disabled while pending. | Note-only: reusing a key for a genuinely different transfer silently returns the old one (standard idempotency, no param-mismatch 409). | `money-account.service.js:224-303`; `transaction.js:41-73`; `transfer-section.tsx:114-168` |
| **M3** duplicate upload | **Solid (sequential) / not concurrency-safe** | Company-scoped (tenant-isolated), checksum = SHA-256 of the whole buffer, FAILED/CANCELLED excluded, file cleaned up on the 409 path, null-checksum degrades gracefully. | **No DB unique on (companyId,checksum)** — the pre-check is a plain TOCTOU read, so **N truly-concurrent identical uploads can all pass and each start an extraction job**. The "save credits" goal is not guaranteed under concurrency; only sequential/double-click/retry is reliably caught. The test openly tolerates this. | `bill.service.js:151-176`; `bill.repository.js` `findLiveBillByChecksum`; `schema.prisma` `checksum String?` + `@@index` |
| **M4** duplicate posting | **Solid (sequential) / not concurrency-safe** | Signature = same file (checksum) **and** party+total+date — both required, so multi-invoice files and genuine reorders aren't mis-flagged. String compare is safe (both sides use the same serializer). Override path works: the 409 stores the draft and the `allowDuplicate` retry reuses that same draft via `findRecordedDraft`. | (a) **Not concurrency-safe** — the check runs outside the posting tx with no unique backstop, so two simultaneous first-posts of the same invoice from two bill records **both succeed** (worst for auto-numbered sales, where nothing else catches it). (b) False-positive on genuinely-distinct-but-identical sibling invoices (blocked, but overridable). (c) Override retry reuses the **stale draft and discards `parsed.data`** — review edits made after the block are lost. | `bill.service.js:56-94,410,487-530`; `bill.repository.js` `findPostedBillsByChecksum` |

**Do the tests genuinely reproduce the defects?** The **integration** tests do: each would fail against pre-fix code (no checksum column → 2nd upload returns 201 not 409; no `findDuplicatePostedBill` → 2nd post succeeds; pre-fix fresh `randomUUID` → duplicate transfers; pre-fix gross taxable → wrong return credit). Two are weak and should not be relied on alone: the H1 **unit** test imports the new `calculateReturnLine` (absent pre-fix, so it only "fails" trivially), and the M2 **malformed-key** test false-passes pre-fix (the strict schema rejected any `idempotencyKey`). The integration suites carry the real regression proof.

**Net:** the fixes are correct and shippable for ordinary (sequential) use. The two concurrency gaps (M3, M4) are real but low-frequency; they are listed in §5 with recommended hardening (a partial/conditional unique index is the clean fix for both). None of this blocks staging.

---

## 2. Inventory accounting — current state, reconciliation, and recommended policy

### 2.1 Current treatment (verified)

`inventory.service.js` imports **no** accounting module — it moves the stock ledger and `InventoryBalance` but never posts to the GL itself. GL entries for stock come only from the purchase/sale/return services and the opening-balances module.

| Topic | Posts a journal entry? | Reconciles to Inventory (1300)? | Evidence |
|-------|------------------------|---------------------------------|----------|
| Opening stock via **opening-balances module** (`initialize`) | ✅ Yes — Dr Inventory 1300 / Cr Owner's Capital 3000 | ✅ By construction | `opening-balance.service.js:494-564`; test `opening-balances-periods.test.js:507` |
| Opening stock via **inventory endpoint** (`createOpeningStock`) | ❌ **No** | ❌ **Silent gap** | `inventory.service.js:353-371` (no-JE comment `:328-336`) |
| **Stock adjustment** (gain / damage / loss / shrinkage) | ❌ **No** | ❌ **Silent divergence** | `inventory.service.js:373-395` |
| **Purchase line discount** | ✅ (purchase posts) — inventory capitalised **gross**; discount credited to **5100 Inventory Valuation Adjustment** | Balanced, but inventory & COGS carry gross | `purchase.service.js:441-447`; `gl-posting.service.js:85-92,102-141`; **5100 is an EXPENSE account** `system-accounts.js:199-204` |
| **WAC on IN / COGS on OUT** | ✅ (sale posts Dr COGS 5000 / Cr Inventory 1300 at frozen cost) | ✅ | `inventory.service.js:102-114,245-257`; `gl-posting.service.js:301-361` |
| **Period-close guard** | read-only; checks trial balance + AR + AP — **no inventory check** | Inventory divergence does **not** block close | `period-verification.service.js:113-126` |

**Reconciliation reality (test-quoted):** inventory valuation matches the 1300 control account **only** under uniform cost through the document flows or the opening-balances module ("matches inventory valuation to the Inventory control account" `dashboard-reports.test.js:996`; "when costs are uniform" `accounting-documents.test.js:1021`; opening-balances `:507`). It **diverges by design** on blended WAC + return-at-original-cost (the "Phase-5 residue", quantified at a 250 gap in `accounting-documents.test.js:1042-1071`, ledger still balanced). It **diverges silently and untested** after any stock adjustment or inventory-endpoint opening stock — no reconciliation test exercises those paths, and 1300 stays flat while the stock ledger moves.

### 2.2 Recommended policy (documentation only — no code changed in Phase 2)

Adopt one consistent policy before real books are kept. Required journal lines:

1. **Opening stock — one GL-backed path.** Either make all products' opening stock go through the opening-balances module, or have `createOpeningStock` also post:
   `Dr Inventory 1300 / Cr Owner's Capital 3000` (qty × unitCost).
   *Implication:* asset and equity both reflect real stock; reconciles by construction. Needed because after the one-time module `initialize`, products added later have **no** GL-backed way to receive opening stock today.

2. **Stock adjustments — must hit P&L.** Add `5110 Inventory Shrinkage/Loss` (EXPENSE) and `5115 Inventory Gain` (contra-expense / other income).
   - Decrease (damage/loss/shrinkage, at current WAC): `Dr 5110 / Cr Inventory 1300`.
   - Increase (count surplus): `Dr Inventory 1300 / Cr 5115`.
   *Implication:* write-downs hit profit when incurred; Inventory asset equals reality; enables a close-time inventory check. **Highest-impact gap** — today losses never reach P&L and the asset stays overstated.

3. **Purchase discount — capitalise NET (recommended).** `Dr Inventory 1300 (gross − discount) / Dr Input Tax 1500 / Cr Accounts Payable 2000`.
   *Implication:* WAC, COGS and balance-sheet inventory reflect the price actually paid; interim gross profit is correct; no expense account carries a credit balance. Trade-off: loses the standalone "discount earned" figure 5100 surfaces today. Keeping **gross** (status quo) overstates held inventory and interim COGS and books the discount up-front as a credit in an expense account (nets to zero over the stock's life but misstates interim figures).

4. **Add an `INVENTORY_RECONCILE` check to the period-close guard** (`period-verification.service.js`): Σ(qty × avgCost) vs the 1300 balance within a documented tolerance for the Phase-5/rounding residue, so books that silently diverge cannot be closed.

**Gaps ranked by financial-statement impact:** (1) adjustments post no GL — **High**; (2) inventory-endpoint/post-init opening stock posts no GL — **High**; (3) purchase discount capitalised gross — **Medium**; (4) no inventory check at close — **Medium (control weakness)**; (5) Phase-5 return residue + 4dp rounding — **Low (by design, documented)**.

> Per the brief, posting logic is **not** changed in Phase 2. These are documented recommendations with their journal entries; implementing #2 and #1 (the High items) should be a scoped Phase-3 change with tests asserting 1300 == stock ledger after an adjustment/opening-stock.

---

## 3. Production-readiness audit

### 3.1 Deployment blockers

| # | Severity | Blocker | Evidence | Required before go-live |
|---|----------|---------|----------|-------------------------|
| B1 | **High (hard blocker)** | **Bill files on ephemeral storage.** Written to local disk; Render's FS is wiped on every redeploy/restart/Free spin-down → source documents for an accounting app vanish. Confirm/post still works (uses `reviewedData` in the DB), but the original image and re-extraction are lost. | `bill-storage.service.js:132-162`; `DEPLOY_RENDER.md:313-325` | Attach a Render **Persistent Disk** (`BILL_STORAGE_DIR=/var/data/bills`, single instance) **or** move to S3/R2 in `bill-storage.service.js`. |
| B2 | **Medium (must-do)** | **`CORS_ORIGIN` defaults to `*` and is warn-only in prod**, not enforced. Mitigated by `SameSite=Strict` first-party cookies, but still must be tightened. | default `config/env.js:44`; warn-only `server.js:13-17`; `app.js:89-93` | Set `CORS_ORIGIN` to the two frontend origins; ideally fail-fast on `*` when `NODE_ENV=production`. |
| B3 | **Medium (must-do)** | **Schema↔migration FK drift on financial tables.** `schema.prisma` declares `onDelete: SetNull` on several FKs (users.companyId, supplier_payables.purchaseId, sales_invoices.creditLimitOverrideById, customer_receivables.salesInvoiceId, accounting_periods.closed/reopenedById, bills.postedById) and drops an index — none are in migration history. `migrate deploy` won't apply them, but a future `migrate dev` would silently ship changed delete-cascade semantics onto money tables. | migration header note in `20261014052105_bill_checksum/migration.sql`; `prisma migrate diff` | Land **one intentional migration** to reconcile (or revert the schema edits) so no one ships it by accident. |

### 3.2 Verified production-SAFE (no action)

- **Tenant isolation:** `companyId` is **never** sourced from request body/query/params — always `req.user`; `require-auth.js` re-reads role/company/isActive from the DB each request (ignores JWT claims).
- **Refresh tokens:** rotation with family-wide **reuse-revocation** outside a 30s grace window; logout revokes the family. Cookies are `httpOnly`, `Secure` in prod, `SameSite=Strict`, path-scoped. **Tokens never appear in response bodies or logs**; the request logger emits only method/path/status/ms.
- **500s don't leak** in prod (generic message; logs `err.message` only, not stack/SQL); health `/db` never returns DB error text. LlamaCloud key never leaves the process; vendor error bodies are logged truncated, never returned.
- **No secrets committed** (only `*.env.example`; a fake `llx-test-key` in tests). Rate limits 300/15m + 20/15m login; subscription 402 gate at the single posting choke point.
- **Migrations:** the new one is additive (`ADD COLUMN checksum TEXT` nullable + index); **no DROP/TRUNCATE/DELETE anywhere** in the 30-migration history; `migrate deploy` applies only committed files.
- **Runtime:** `engines.node ">=20"`, Render `NODE_VERSION=22` — match. (Local Node 25.9.0 is outside Prisma 6.x's tested range — local-only risk; prod unaffected.)

### 3.3 Lower-severity items

- **Low** — `extractionError` can surface a raw non-`ApiError` message to the (same-tenant) client (`bill.service.js:239,311`); store a generic message, keep detail in logs.
- **Low** — the Prisma `P2002` handler echoes offending column names (`error-handler.js:38-40`); return a generic "already exists".
- **Low** — `backend/check-users.js` is committed and dumps all users across all tenants to console (not HTTP-reachable; needs DB creds). Delete or gitignore.
- **Low** — graceful shutdown has no force-exit timeout and no `uncaughtException`/`unhandledRejection` handlers (`server.js:21-30`); Render SIGKILLs after grace, so acceptable.
- **Low/Med** — backup: Neon Free is a **6-hour** instant-restore window only, no off-site/automated backup; document a scheduled logical backup (or a paid restore window) before real data.
- **Cosmetic** — package still named `pharma-erp-backend`, DB `pharma_erp`.

---

## 4. Staging QA preparation

### 4.1 Deploy to staging (from `DEPLOY_RENDER.md`, adapted — dedicated DB + test shop only)

1. **Separate everything from production.** New Neon project (or a dedicated branch) as the staging DB; a **new** `byapar-api-staging` / `byapar-admin-staging` / `byapar-web-staging` set, same region as the DB. Never point staging at the production DB.
2. **byapar-api-staging** (Root `backend`, build `npm ci --include=dev && npx prisma generate`, start `npm run start:render`, health `/api/v1/health`): set `NODE_VERSION=22`, `NODE_ENV=production`, `DATABASE_URL` (Neon **direct/unpooled**), a **fresh** `JWT_SECRET`, `TRUST_PROXY=2`, and — to make the AI flow testable and durable — a **Persistent Disk** mounted at `/var/data` with `BILL_STORAGE_DIR=/var/data/bills`, plus `LLAMA_API_KEY` (staging key). Leave `CORS_ORIGIN` unset for the first boot. Deploy; `migrate deploy` applies all migrations incl. `bill_checksum` to the empty DB.
3. Check `https://<api-staging>/api/v1/health` and `/api/v1/health/db`.
4. Seed a platform admin from your machine against the **staging** `DATABASE_URL` (`npm run seed:platform`), then create one test shop (ADMIN) + one staff user.
5. **byapar-admin-staging** and **byapar-web-staging** (Root `frontend`/`business-web`, `NODE_VERSION=22`, `API_URL=https://<api-staging>.onrender.com/api/v1`). Deploy.
6. On byapar-api-staging set `CORS_ORIGIN` to the two staging frontend URLs → Save & deploy.
7. (Optional) seed demo data from your machine against the staging URL (`seed:demo*`) — the demo seed refuses non-local/production, so for staging use real test data entered through the UI instead, or run seeds locally then dump/restore.

### 4.2 Staging test checklist

Status key: **PASS** = verified this session (at API/code level); **NOT TESTED** = requires a running staging browser/live provider (not available here); **BLOCKED** = cannot pass until a blocker is fixed. No row is marked PASS on the strength of a browser or live-AI run, because none was performed.

| # | Scenario | Pre-staging status | Basis / note |
|---|----------|--------------------|--------------|
| 1 | Shop login + session persistence (15-min access, quiet refresh, logout revokes) | NOT TESTED (browser) | Auth logic verified in code (§3.2); needs the real-browser cookie/refresh walk-through (runbook post-deploy 2–5). |
| 2 | Create sale → line math, subtotal/discount/tax/total, paid/partial/credit, receivable, stock out, GL | PASS (API) · NOT TESTED (UI) | Covered by the backend suite (sales + accounting-documents). Confirm in the UI on staging. |
| 3 | Create purchase → totals/tax, full/partial payment, payable, stock in at WAC, GL | PASS (API) · NOT TESTED (UI) | Backend suite (purchases + supplier-payments). |
| 4 | Sales return & purchase return (incl. **discounted** purchase return — H1) | PASS (API) · NOT TESTED (UI) | H1 regression tests pass; verify a discounted return credit in the UI. |
| 5 | Dual-role party: customer receipt doesn't settle supplier payable and vice-versa | PASS (API) | Isolation proven in code + tests (QA audit §D). Spot-check in the UI. |
| 6 | Customer receipts & supplier payments, allocation, overpayment rejected | PASS (API) · NOT TESTED (UI) | Backend suite (credit-collections). |
| 7 | Inventory movements & reports reconcile to transactions | PASS (API) with caveat | Reconciles via document flows; **note the §2 gaps** (adjustments/opening-stock post no GL). Do **not** rely on stock adjustments reconciling. |
| 8 | **Printed** AI bill import, IN and OUT: upload→extract→review→confirm→post, ledger+stock | **BLOCKED** then NOT TESTED | Blocked until durable storage (B1) + `LLAMA_API_KEY` on staging. Then a human must verify extraction field-by-field against the document. |
| 9 | **Handwritten** AI bill import, IN and OUT | **BLOCKED** then NOT TESTED | Same as #8; handwriting is the harder accuracy case — check every field. |
| 10 | Duplicate upload (M3): same file refused with reference; `allowDuplicate` keeps both; different file allowed | PASS (API) · NOT TESTED (UI) | Backend `bill-duplicate` tests. Also try two near-simultaneous uploads — expect the **concurrency residual** (both may proceed); log it. |
| 11 | Repeated confirmation / duplicate posting (M4): second bill, same invoice, different/blank number → blocked; override records it | PASS (API) · NOT TESTED (UI) | Backend `bill-duplicate` tests (IN + OUT). Try two simultaneous confirms — expect the **concurrency residual** (possible double-post); log it. |
| 12 | Concurrent transfer submissions / double-click (M2) → exactly one transfer | PASS (API) · NOT TESTED (UI) | `money-transfer-idempotency` test incl. the concurrent case. |
| 13 | Mobile + desktop UI, 320px layout, validation, error states, print output | NOT TESTED (browser) | business-web unit/typecheck pass; visual/responsive/print need a real browser. |

---

## 5. Remaining issues — consolidated severity register

| ID | Sev | Issue | Owner/next step |
|----|-----|-------|-----------------|
| B1 | **High** | Bill files on ephemeral storage (prod blocker) | Persistent disk or S3/R2 before go-live |
| INV-1 | **High** | Stock adjustments post no GL (losses never reach P&L; asset misstated) | Phase-3: policy §2.2(2) + tests |
| INV-2 | **High** | Inventory-endpoint / post-init opening stock posts no GL | Phase-3: policy §2.2(1) |
| B2 | **Med** | CORS `*` warn-only in prod | Set origins; fail-fast on `*` in prod |
| B3 | **Med** | Schema↔migration FK drift on financial tables | One intentional reconciling migration |
| M4-CC | **Med** | M4 duplicate-posting not concurrency-safe (double-post on simultaneous confirms, esp. auto-numbered sales) | Partial-unique index on a posting signature, or an in-tx guard |
| M3-CC | **Med** | M3 duplicate-upload not concurrency-safe (N jobs under N concurrent uploads) | Partial-unique index on (companyId, checksum, live) |
| INV-3 | **Med** | Purchase discount capitalised gross into an expense account | Phase-3: policy §2.2(3) |
| INV-4 | **Med** | Period close has no inventory reconciliation | Add `INVENTORY_RECONCILE` guard |
| M4-ED | **Low** | M4 override retry reuses stale draft, discards post-block review edits | Re-apply `parsed.data` to the reused draft on override |
| H1-DOC | **Low** | Stale "No tax is reversed" comment in `gl-posting.service.js:172-174` | Correct the comment |
| H1-COV | **Low** | H1 tests miss partial-FIXED, IGST, multi-line, proration-drift | Add cases |
| ERR-1 | **Low** | Raw non-ApiError text to client via `extractionError` | Generic message + log detail |
| ERR-2 | **Low** | P2002 handler echoes column names | Generic "already exists" |
| DEBUG | **Low** | `check-users.js` dumps all users | Delete/gitignore |
| RUN | **Low** | Local Node 25 vs prod 22; cosmetic `pharma_erp*` names | Pin local Node 22 |
| SHUT | **Low** | No shutdown timeout / process error handlers | Add both |
| BKP | **Low/Med** | Neon Free 6h restore only | Document scheduled backup |

---

## 6. Exact next steps

1. **Unblock staging:** attach a Persistent Disk to the staging API, set `BILL_STORAGE_DIR=/var/data/bills`, add a staging `LLAMA_API_KEY`, and set `CORS_ORIGIN` to the staging frontend origins (B1, B2).
2. **Land one reconciling migration** for the FK-`onDelete` drift (B3) so `migrate dev` can't ship it unintentionally; review it before applying, keep it additive/non-destructive.
3. **Decide the inventory accounting policy** (§2.2) and schedule Phase-3 to implement adjustments-post-to-P&L and a single GL-backed opening-stock path, each with a 1300-vs-stock-ledger reconciliation test; add the close-time inventory check.
4. **Concurrency hardening** for M3/M4: add partial/conditional unique indexes (checksum-live for uploads; a posting signature for confirms) so the duplicate protections hold under simultaneous requests; fix the M4 override edit-discard.
5. **Low-severity cleanup:** generic error messages (ERR-1/2), remove `check-users.js`, correct the stale H1 comment, add the missing H1 test cases, add shutdown/process-error handlers, document a backup schedule.
6. **Run the staging checklist (§4.2)** on a dedicated test shop — especially the browser session/print items and the live printed + handwritten AI-bill runs (IN and OUT), checking extraction field-by-field; record PASS/FAIL against each row. Never run destructive tests against production.

### Uncertainties stated explicitly
- Pre-fix defect reproduction is **reasoned**, not re-run against a reverted tree (the full post-fix suite was run and passes). I can demonstrate a pre-fix failure on request.
- No browser or live-LlamaExtract behaviour was observed; all such rows are NOT TESTED/BLOCKED.
- The inventory recommendation is a proposal; the gross-vs-net discount choice has a real trade-off (loses the standalone discount-earned figure) and should be confirmed with whoever owns the chart of accounts before implementation.
