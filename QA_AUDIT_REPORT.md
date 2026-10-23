# QA Audit Report — Shop Owner Web Application (`business-web` + `backend`)

**Audit date:** 2026-10-13
**Auditor:** Senior QA / accounting-workflow validation (code + API + automated-test audit)
**Scope:** `business-web` (shop app, port 3002) and its `backend` (Express 5 + Prisma + PostgreSQL)
**Method:** Static source + dependency-graph tracing of every module (routes → controller → service → repository), verification of accounting/stock/tax logic, and execution of the backend automated test suite against the local test database. No production system touched.

---

## 0. Important scope note — what this audit is and is not

The original plan called for **live browser testing** (open the login URL, click through pages, capture screenshots). That was **not performed**, because this session has **no browser-automation tool**, and no login URL/credentials were supplied. Instead, with your approval, the audit was run as a **code + API + automated-test audit against local dev**, which verifies business-logic correctness far more rigorously than click-through testing, but does **not** cover:

- Visual rendering, responsive/mobile layout, loading/empty/error UI states as actually drawn
- Real browser session persistence, cookie behaviour across ports, client-side form UX
- A real printed/handwritten bill pushed through the live LlamaExtract provider (Phase H end-to-end needs the live API + credits)

These remain **open** and are listed in §9. Everything below is backed by file:line evidence or a passing automated test.

**Environment:** Local dev. Backend test DB `localhost:5432/pharma_erp_test`. **Runtime is Node 25.9.0**, while the project targets Node ≥20 and deploys on **Node 22** — local results reflect a newer runtime than production (not a defect, but noted).

---

## 1. Executive summary

**Overall health: strong.** This is a well-engineered accounting system. Double-entry balances by construction, every GL write funnels through a single balanced-entry engine, money is pure `Decimal` (no floats), stock is an immutable ledger with negative-stock blocked, and the unified-party model keeps customer receivables and supplier payables rigorously isolated.

- ✅ **Backend automated suite: 65 test files / 1834 tests passing, 0 failures** (279s, real DB). The `prisma:error` lines in the log are *intentional* — concurrency/idempotency tests deliberately forcing unique-constraint collisions to prove the retry logic holds.
- ✅ Every one of the 48 shop navigation links resolves to a real page with live API wiring; no "coming soon" placeholders; absent features (Estimates, Sales/Purchase Orders, Delivery Challans, inter-warehouse transfer, batch/expiry) are **intentionally** omitted and surfaced via `<NotAvailable>` cards.
- ✅ Customer-receipt / supplier-payment isolation, overpayment rejection, GST intra/inter-state split, and report-from-posted-documents are all **correct**.

**Defects found:** 1 High, 4 Medium (+1 documented-by-design Medium to confirm), ~9 Low/cosmetic. None block core billing; the High and two Mediums have real money/accounting impact under specific, realistic conditions.

---

## 2. Findings register (severity-ranked)

| ID | Sev | Area | Finding | Evidence |
|----|-----|------|---------|----------|
| **H1** | **High** | Purchase returns | **Purchase-return ignores the original line discount.** Return line = `qty × unitCost` (GROSS), and input-tax is recomputed on that gross taxable. If the original purchase line carried a trade discount, the supplier credit (Dr A/P), input-GST reversal, and debit-note total are all **overstated**; the payable is over-reduced. Sales-return correctly prorates the discount — the asymmetry confirms the omission. Triggers only when purchase lines carry discounts (common in Indian trade). | `purchase-returns/purchase-return.service.js:195-208` vs `sales-returns/sales-return.service.js:165-174`; discount persisted separately from `unitCost` at `purchases/purchase.calculator.js:64-67,133-159` |
| **M1** | **Med** | Inventory ↔ GL | **Stock adjustments & opening stock post no journal entry.** `inventory.service.js` contains no GL call at all; `createAdjustment`/`createOpeningStock` change inventory value without posting. The GL Inventory control account then diverges from the stock sub-ledger, and shrinkage/damage books no inventory-loss expense (asset overstated). An in-code comment marks this intentional — confirm it is the accepted, documented limitation. | `inventory/inventory.service.js` (no `glPosting` reference; `createAdjustment` ~328-344, `createOpeningStock` ~353-395) |
| **M2** | **Med** | Money transfer | **Transfer is not idempotent.** `sourceId: randomUUID()` per call defeats the `(companyId, sourceType, sourceId)` duplicate guard (opening-balance JEs correctly key on `account.id`). A client double-submit creates two transfer entries: total cash still nets to zero, but the from/to **per-account balances move twice**. | `money-accounts/money-account.service.js:228` (vs opening at `:169-174`) |
| **M3** | **Med** | AI bill import | **Duplicate file uploads are not deduped.** A sha256 `checksum` is computed but never persisted or checked; every upload builds a fresh `storageKey` from a new UUID. Re-uploading the same bill creates a second draft + a second LlamaExtract call (**wastes credits**). The "unique storageKey prevents double posting" only stops two bill rows sharing one file. | `bills/bill-storage.service.js:170`; `bills/bill.service.js:102-111` |
| **M4** | **Med** | AI bill import | **Cross-row double-post guard is weak.** The only thing stopping the same invoice posting twice via two separate bill rows is downstream purchase/sales doc-number uniqueness (supplier + invoiceNumber). If `invoiceNumber` is blank or differs, two postings succeed. The Bill-level `(companyId, postedSourceType, postedSourceId)` unique only prevents re-linking one bill row. | `bills/bill.service.js:408,456-463` |
| M5 | Med (by-design — confirm) | Purchase GL / costing | Inventory is capitalised at **gross** line cost; the purchase discount is plugged to `INVENTORY_VALUATION_ADJUSTMENT`. The entry balances, but inventory & moving-average are carried **above** actual paid cost, inflating downstream COGS. Trade discount is not netted into stock cost. Flagged as documented/by-design — verify against `backend/docs/architecture.md`. | `accounting/gl-posting.service.js:85-141`; IN uses raw `item.unitCost` at `inventory/inventory.service.js:234-235` |
| L1 | Low | Opening balances (UI) | Opening Balances page is **view-only** — it reads balanced status but has no "set balances" action in the shop UI (surfaced as `<NotAvailable>`). Backend supports it; the shop can't drive it. | `business-web/src/features/accounting/opening-balance-page.tsx:87-90` |
| L2 | Low | Sales posting | **Error precedence:** credit-limit is checked before the period guard + subscription gate (which run last, inside the journal). A closed-period or expired-subscription post can return `422 CREDIT_LIMIT_EXCEEDED` instead of the period/`402` error. Atomic rollback keeps data correct; only the error message is misleading. | `sales/sales.service.js:580-596` → `accounting/journal.service.js:208-220` |
| L3 | Low | AI bill import | `confirm` blocks only POSTED/CANCELLED; there is **no explicit `status===REVIEW` precondition**, and `PATCH /review` is not a required prior call. Safe in practice (payload is human-supplied + schema-validated) but the review step is implicit, not enforced. | `bills/bill.service.js:330-339` |
| L4 | Low | AI bill import | **No-key behaviour inconsistent with contract.** Missing `LLAMA_API_KEY` on *upload* saves the bill as FAILED and returns **201** (graceful); the documented "no key ⇒ 503" only fires on the retry/extract path. | `bills/bill.service.js:121-128`; `bills/bill-extraction.service.js:248-254` |
| L5 | Low | AI bill import | FAILED path can write a raw non-`ApiError` message (e.g. Prisma/normalize) to `extractionError`, which is client-visible. LlamaCloud errors themselves are mapped to safe text. | `bills/bill.service.js:160,231` |
| L6 | Low | Credit book | Default `asOfDate` uses UTC `new Date().toISOString()` rather than company timezone, so overdue classification can be off by a day in IST early morning (the dashboard correctly uses company tz). | `reports/credit.service.js:136,172` |
| L7 | Low | Authz (comments) | Route comments mis-state the real authz: party writes are permission-gated (`PARTIES_MANAGE`/`CUSTOMERS_CREATE`) and payment posting by `MONEY_RECEIVE`/`MONEY_PAY`, **not** strictly ADMIN as the comments claim. **Enforcement is correct** and platform users are blocked; only the comments mislead. | `parties/party.routes.js:20-21`; `customer-payments/customer-payment.routes.js:16-17` |
| L8 | Low | Payables (cosmetic) | Zero-value payable derives status `CREDITED` where the receivable derives `OPEN` — cosmetic mismatch, only reachable with a zero original amount (not produced by posting). | `supplier-payables/supplier-payable.service.js:84-93` vs `customer-receivables/customer-receivable.service.js:86-95` |
| L9 | Low | GST (cosmetic) | State-code labels only: code 28 = "Andhra Pradesh (before division)", 26 merged-name. Split logic unaffected. | `tax/state-codes.js:33-37` |
| E1 | Env | Runtime | Local Node 25.9.0 vs project target Node ≥20 / deploy Node 22. Validate on Node 22 before trusting local-only results. | `backend/package.json` engines |

Pre-existing known tech-debt from the project map that is QA-relevant (not re-verified here): bill files on local disk are lost on each Render redeploy; `backend/check-users.js` dumps all users to console; `CORS_ORIGIN` defaults to `*`; `frontend/next.config.mjs` sets `eslint.ignoreDuringBuilds: true`.

---

## 3. Automated test suite (end-to-end against real DB)

```
Test Files  65 passed (65)
     Tests  1834 passed (1834)
  Duration  279.02s
  Exit code 0
```

Coverage spans the full accounting surface: sales/purchases posting, returns, customer/supplier payments & allocations, credit limits & collections, GST documents + GSTR-1/3B + reconciliation, dashboard/business reports, inventory, money accounts, opening balances & periods, parties + party-backfill, bills + bill-AI-hardening + bill-matching, staff RBAC, share-links, platform SaaS, and more. Concurrency/idempotency tests (double-submit, parallel postings) are present and green. This is the single strongest signal in the audit: the posting engine, double-entry, sub-ledger reconciliation, and GST aggregation are provably correct under the tested scenarios.

---

## 4. Phase 2 — Feature inventory (shop app)

**Legend:** IMPLEMENTED = real UI + live API · PARTIAL = real UI + API, with some sub-features shown as `<NotAvailable>` · MISSING = intentionally absent (NotAvailable card, not in nav).

| Feature | Status | Feature | Status |
|---|---|---|---|
| Dashboard / Home | IMPLEMENTED | Credit Book | IMPLEMENTED |
| Quick Billing | IMPLEMENTED | Money Received / Paid | IMPLEMENTED |
| Sales home | PARTIAL | Expenses | IMPLEMENTED |
| Sales invoice new/[id]/edit | IMPLEMENTED | Cash & Bank | PARTIAL |
| Sales returns | IMPLEMENTED | Accounting — Accounts | IMPLEMENTED |
| Estimates / Quotations | MISSING (by design) | Accounting — Journal & Ledger | IMPLEMENTED |
| Sales Orders | MISSING (by design) | Opening Balances | PARTIAL (view-only — L1) |
| Delivery Challans | MISSING (by design) | Accounting Periods | IMPLEMENTED |
| Purchases home | PARTIAL | Report — Sales / Purchases / Stock | PARTIAL |
| Purchase bills new/[id]/edit | IMPLEMENTED | Report — Customers / Suppliers | IMPLEMENTED |
| Purchase returns | IMPLEMENTED | Report — Expenses / P&L / GST | IMPLEMENTED |
| Supplier Payables | IMPLEMENTED | GST registration | IMPLEMENTED |
| Purchase Orders | MISSING (by design) | AI Bill Upload | IMPLEMENTED |
| Products / Items (+combos) | IMPLEMENTED | Subscription | IMPLEMENTED |
| Stock dashboard / in / out / adjustments | PARTIAL | Profile | IMPLEMENTED |
| Stock Transfers (inter-warehouse) | MISSING (by design) | Business Settings (+locations/stores/money) | IMPLEMENTED |
| Low Stock | IMPLEMENTED | Staff (RBAC) | IMPLEMENTED |
| Customers (+import) / Suppliers | IMPLEMENTED | Recycle Bin | PARTIAL |
| Unified Parties (+relationships) | IMPLEMENTED | Offers / Billers report (extra) | IMPLEMENTED |

**No navigation gaps, no orphan routes, no "coming soon" strings** (foundation tests 26b and 27 satisfied). PARTIAL pages are fully functional; the "partial" marker only means a `<NotAvailable>` card lists future sub-features alongside working functionality.

---

## 5. Phase 4 — Workflow verdicts

**A. Authentication & RBAC — PASS.** Bearer JWT re-reads role/company/permissions/active from DB each request; httpOnly SameSite cookies with rotating refresh tokens (family-reuse revocation); maker-checker (STAFF draft / ADMIN post); tenant `companyId` always from the token, never request input; platform users blocked from shop/party routes. Covered by `auth.test.js`, `shop-staff-permissions.test.js`, `users.test.js` (all green). *Note L7: a couple of route comments overstate "ADMIN only" where the real gate is a permission key — enforcement is correct.*

**B. Sales — PASS.** Line math (qty×rate, discount NONE/%/FIXED, taxable, CGST/SGST vs IGST by server-decided supply type, line total) correct; totals sum already-rounded lines (no drift); Dr A/R / Cr Sales / Cr Output tax balanced; stock out at frozen moving-average COGS; negative stock blocked; receivable raised OPEN; one retryable transaction with consistent lock order. Returns reverse receivable + stock (at frozen cost) + GL correctly with discount prorated. Posted docs immutable.

**C. Purchases — PASS with one High defect.** Posting mirror of sales is correct (stock in at WAC, payable, balanced GL). **Two issues:** H1 — purchase **returns** ignore the original line discount (overstates supplier credit + input-GST); M5 — inventory capitalised at gross cost (discount parked to a variance account), inflating WAC/COGS (documented, confirm).

**D. Party relationships — PASS (isolation sound).** A party can be Customer-only, Supplier-only, or both; shared fields copied under a row lock; **no auto-merge** (duplicates only advisory; merge only via explicit human link). **Critically: a customer receipt can only reduce customer receivables (same-`Customer.id` re-checked under lock) and a supplier payment only supplier payables** — the two services share no repository, table, or allocation field, so no cross-contamination path exists even for a dual-role party, and the two balances are never netted.

**E. Credit book & payments — PASS.** Allocation ≤ outstanding (checked at draft and re-checked under row lock at post); partial payments walk a doc OPEN→PAID; **overpayment rejected** (per-invoice and allocations-exceed-payment → 422); negative/zero rejected at the zod layer; excess beyond allocations intentionally retained as an advance and posted as real money; one ledger entry + GL per payment, no double counting; concurrency-safe (id-ordered locks, retryable tx).

**F. Inventory — PASS with one Medium.** Immutable `StockMovement` ledger, one movement per balance change, row-locked; WAC on IN, cost frozen on OUT; negative stock hard-blocked; cancellations/returns post reversing movements (never delete). **M1:** adjustments & opening stock change value with **no GL entry** → GL Inventory diverges from the sub-ledger. Low-stock alert logic correct (`reorderLevel` 0 = disabled).

**G. Expenses & cash/bank — PASS with one Medium.** Expense = one balanced JE, no GST, split `paymentParts` sum to total, no double posting (unique + DRAFT-gated post + separate reversal source). Money-account opening/transfer/reverse all balanced; balances derived from POSTED GL (not frontend), cash/bank roll-up has no parent/child double count. **M2:** transfer not idempotent (random `sourceId`).

**H. AI bill import — PASS on the safety-critical property, with two Mediums.** **Model output can never auto-post:** `confirm` posts a human-supplied, schema-validated payload through the identical purchase/sales calculators and RBAC — it never reads the raw `extraction`. Upload validation is robust (magic-byte sniff, size, empty-file reject). Party identification offers suggestions for both directions, auto-selects nothing. **M3** (duplicate uploads not deduped — wastes credits) and **M4** (cross-row double-post guard weak when invoiceNumber blank) are the real gaps; L3/L4/L5 are minor. *Live-provider extraction accuracy on real printed/handwritten bills was not tested here — see §9.*

**I. Reports & GST — PASS.** Every report total derives from POSTED documents / the GL (sales/purchases/payments filter `POSTED`; receivables/payables from sub-ledger; inventory = qty×avgCost; cash/bank from GL — not receipts−payments). Periods are inclusive UTC-midnight with company-tz "today". GSTR-1/3B aggregate frozen line snapshots that provably reconcile to document headers and GL control accounts; intra/inter-state split is server-decided and never mixed. No frontend money arithmetic (final figures serialized server-side). Only L6 (credit asOf tz) and L9 (cosmetic labels).

---

## 6. UI-layer checks (business-web)

- **TypeScript typecheck (`tsc --noEmit`): PASS** (exit 0, no type errors).
- **Component/logic tests (`vitest` + jsdom): 19 files / 225 tests passed** (exit 0, 13.7s).

These cover the shop app's foundation/navigation contracts (incl. the nav-has-page and no-"soon" guards), permission mirror, and feature-level logic. They do **not** render a real browser — visual/interaction coverage remains open (§9).

---

## 7. Recommended fixes (priority order)

1. **H1** — In `purchase-return.service.js`, prorate the original line discount exactly as `sales-return.service.js:165-174` does (`discount × returnQty / originalQty`), and compute input-tax on the discounted taxable. Add a regression test with a discounted purchase line returned in full and in part.
2. **M2** — Give transfers a deterministic/idempotency key (e.g. client-supplied request id, or hash of from/to/amount/date) instead of `randomUUID()`, so the existing unique guard dedupes double-submits. (Low effort, prevents wrong per-account balances.)
3. **M3/M4** — Persist and check the sha256 `checksum` to dedupe re-uploaded files; and add a bill-level guard that refuses to post when another POSTED bill already covers the same (companyId, direction, supplier/customer, invoiceNumber) — or require a non-blank invoiceNumber before confirm.
4. **M1 / M5** — Decide and document the inventory-costing policy: either post adjustment/opening-stock JEs (so GL = sub-ledger and shrinkage books a loss) or formally document the divergence in `docs/architecture.md`; and decide whether purchase discount should net into stock cost.
5. **L1** — Add the "set opening balances" action to the shop UI (backend already supports it).
6. **L2–L9, E1** — Reorder guards for correct error precedence; enforce `status===REVIEW` on confirm; align no-key behaviour with the 503 contract; sanitize `extractionError`; use company tz for credit asOf; correct misleading route comments; cosmetic status/label fixes; validate on Node 22.

---

## 8. Appendix — automated test evidence

- Backend: `backend/` `npm test` → **65 files / 1834 tests passed, exit 0**, 279s, against `localhost:5432/pharma_erp_test`.
- `prisma:error` log lines = intentional unique-constraint collisions inside concurrency/idempotency tests (each followed by a ✓); **not** failures.
- business-web: `npm run typecheck` → **exit 0, no type errors**; `npm test` → **19 files / 225 tests passed, exit 0**, 13.7s.

## 9. Open items NOT covered (require a live browser / live provider)

- Visual/responsive rendering, loading/empty/error UI states, mobile bottom-tab & command-menu behaviour
- Real browser session persistence and the documented cross-port cookie-sharing dev caveat
- Client-side form validation UX and print (`PrintActions`) output
- **Phase H live:** a real printed bill and a real handwritten bill pushed through LlamaExtract, with extraction accuracy checked field-by-field against the source document (needs live `LLAMA_API_KEY` + credits)
- Share-link public pages (`/s/[token]`) rendered in a browser

To close these, provide a reachable shop URL + test credentials and either a browser-automation tool in-session or a screen-share where you drive and I analyze.

---

### Severity definitions
**High** = wrong money/accounting under a realistic path. **Medium** = wrong money/state under a narrower condition, or a reconciliation/duplication gap. **Low** = cosmetic, message-only, UX, or safe-but-implicit. **Env** = environment/runtime mismatch.
