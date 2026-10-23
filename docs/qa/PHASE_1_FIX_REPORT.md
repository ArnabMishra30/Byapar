# Phase 1 Fix Report — Critical Accounting & Duplicate-Posting Defects

**Date:** 2026-10-14
**Scope:** Findings H1, M2, M3, M4 from the QA audit ([QA_AUDIT_REPORT.md](../../QA_AUDIT_REPORT.md) at repo root; the Phase-1 brief referenced `docs/qa/SHOP_WEB_E2E_AUDIT.md`, which did not exist — the root report is the source of truth).
**Approach:** Smallest safe change per finding, following the existing repository → service → controller → route architecture. No floating-point money, no weakened auth/tenant/accounting invariants, no destructive DB operations, one additive migration.

---

## Summary

| ID | Defect | Status | Migration | New tests |
|----|--------|--------|-----------|-----------|
| H1 | Purchase return ignored the original line discount | **Fixed** | none | 10 unit + 5 integration |
| M2 | Money transfer not idempotent (duplicate on retry/double-click) | **Fixed** | none | 5 integration |
| M3 | Duplicate AI bill uploads not detected | **Fixed** | 1 additive | covered in bill-duplicate (5) |
| M4 | Same invoice posted twice via separate bill records | **Fixed (layered)** | reuses M3 | covered in bill-duplicate (4) |

All four are fixed. M4 is "layered": the existing document-level uniqueness already hard-blocks same-invoice-number duplicates in-transaction; the new code closes the blank/differing-number gap with a high-confidence, override-able guard (see M4 below for the one accepted residual).

---

## H1 — Purchase-return discount proration

**Root cause.** `purchase-return.service.js` computed each return line as `quantity × unitCost` (gross) and reversed input GST on that gross figure, never subtracting the original purchase line's discount. The supplier credit (Dr Accounts Payable), the input-tax reversal, and the debit-note total were therefore overstated whenever a purchase line carried a discount. Sales returns already prorated the discount — the asymmetry confirmed the omission.

**Fix.** Added a pure, unit-testable helper `calculateReturnLine({ returnQuantity, purchasedQuantity, unitCost, originalDiscountAmount })` that mirrors the sales-return proration: it prorates the original line's `discountAmount` by `returnQuantity / purchasedQuantity` and returns the **net taxable** (`gross − proratedDiscount`). `resolveAndValidate` now uses that net amount as the line's taxable base and computes GST on it. This flows into the header `taxableTotal`/`taxTotal`/`grandTotal`, the supplier credit, and the input-GST reversal — all now computed on the discounted amount.

The journal stays balanced automatically: the existing `varianceLine` plug in `gl-posting.service.js` (`INVENTORY_VALUATION_ADJUSTMENT`) absorbs the discount, exactly as it already does on the original purchase — so inventory is still reversed at the gross cost it was capitalised at, and the discount is a symmetric price variance on both legs. Rounding, `Decimal` arithmetic, stock movements, and transaction boundaries are unchanged.

**Files changed**
- `backend/src/modules/purchase-returns/purchase-return.service.js` — new `calculateReturnLine`; `resolveAndValidate` uses the net taxable; added `divide`/`isZero` imports.

**Tests added**
- `backend/tests/unit/purchase-return-calculator.test.js` (10) — proration for no-discount, full, partial, FIXED discount, float-safety, zero-quantity guard, additivity.
- `backend/tests/integration/purchase-return-discount.test.js` (5) — posts real discounted purchases and asserts the return credit **and** the supplier payable reduction use the net amount: non-GST full + partial + FIXED, and GST full + partial (input tax reversed on the discounted base, CGST/SGST split).

---

## M2 — Money-transfer idempotency

**Root cause.** `money-account.service.js` `transfer()` set the journal entry's `sourceId` to a fresh `randomUUID()` on every call, so the `(companyId, sourceType, sourceId)` unique index provided no protection: a retry or double-click created a second `MONEY_TRANSFER` entry and the from/to account balances moved twice (the total cash still netted to zero, which is why it was easy to miss).

**Fix.** The transfer request now accepts an optional **client-supplied `idempotencyKey`** (a UUID), which becomes the journal `sourceId`. The unique index then guarantees at most one transfer per key per company. A content-derived key was deliberately **not** used: two genuinely-separate transfers can have identical amount/accounts/date and must both go through. The flow:
- Fast path: if a transfer with that key already exists, return it unchanged.
- Inside the retryable transaction, re-check by key before inserting, so a concurrent race — where the first commits and the second's insert hits the unique constraint — is retried by the wrapper and resolves to the winner instead of inserting a duplicate.
- A final catch returns the existing transfer if a unique violation still surfaces after retries.

Absent a key, the historical behaviour (a fresh id, no dedup) is preserved, so existing API callers are unaffected.

**Frontend.** The Cash & Bank transfer dialog generates one `idempotencyKey` per intended transfer (a `useRef`), re-sends it on retry/double-click, and clears it after a success (and on reopen) so the next transfer gets its own key. The submit button was already disabled while a transfer was in flight.

**Files changed**
- `backend/src/modules/money-accounts/money-account.service.js` — `idempotencyKey` handling; `findTransferBySource` helper.
- `backend/src/modules/money-accounts/money-account.routes.js` — `idempotencyKey` (UUID) added to the transfer body schema.
- `business-web/src/features/cash-bank/transfer-section.tsx` — per-transfer key, `newIdempotencyKey()` helper.
- `business-web/src/lib/api/money-accounts.ts` — `idempotencyKey?` on the transfer body type.

**Tests added**
- `backend/tests/integration/money-transfer-idempotency.test.js` (5) — sequential retry records once; **concurrent duplicate submissions create exactly one transfer** (all responses point at it); two genuinely-distinct transfers with identical amounts both go through; legacy no-key behaviour preserved; malformed key rejected (400).

---

## M3 — Duplicate AI bill uploads

**Root cause.** `storeBill()` computed a SHA-256 `checksum` of the uploaded bytes but it was never persisted or checked, and every upload built a fresh `storageKey` from a random UUID. Re-uploading the same file silently created a second bill and a second (paid) LlamaExtract job.

**Fix.** Persist the checksum and detect duplicates per company. On upload, after the file is stored and validated, if a **live** bill (status UPLOADED / PROCESSING / REVIEW / POSTED — *not* FAILED or CANCELLED) in the same company already carries that checksum, the upload is refused with `409 BILL_DUPLICATE_UPLOAD` and a reference to the existing bill (`errors[0].existingBillId`), and the just-stored file is removed. FAILED/CANCELLED are excluded so re-uploading after a failed read or a cancellation still works. An explicit `allowDuplicate` flag lets the uploader intentionally keep both. The lookup is company-scoped, so one shop's file can never match — or reference — another's.

**Files changed**
- `backend/prisma/schema.prisma` — `Bill.checksum String?` + `@@index([companyId, checksum])`.
- `backend/prisma/migrations/20261014052105_bill_checksum/migration.sql` — the additive migration (see Migration safety).
- `backend/src/modules/bills/bill-repository.js` — `findLiveBillByChecksum`, `findPostedBillsByChecksum`, `findChecksum`.
- `backend/src/modules/bills/bill.service.js` — persist `checksum` on upload and on sibling bills; duplicate-upload check; `wantsAllowDuplicate`.
- `backend/src/modules/bills/bill.validation.js` — `allowDuplicate` on the upload schema.

---

## M4 — Same invoice posted twice through separate bill records

**Root cause.** The `(companyId, postedSourceType, postedSourceId)` unique on `Bill` only prevents re-linking **one** bill to a document. Two different bill records could each post their own new purchase/sale for the same real invoice.

**Existing hard guard (kept).** Purchases already enforce `@@unique([companyId, supplierId, invoiceNumber])` (plus an explicit `assertInvoiceNumberIsFree`) and sales enforce `@@unique([companyId, invoiceNumber])`. These hard-block the same-number case in-transaction at the database. The real gap is a blank or **differing** invoice number — and, for sales, the invoice number is auto-generated and so never collides.

**Fix.** At confirm, before posting (and only when `postImmediately`), the service checks for a near-certain duplicate: another **POSTED** bill in the same company, same direction, with the **same file checksum**, whose posted document matches on **(party, grandTotal, invoiceDate)**. A match requires both the same file *and* the same content, so:
- it does **not** rely on the invoice number (handles blank/differing), and does not rely on the checksum alone;
- a multi-invoice file (same checksum, different totals/dates) is never falsely flagged;
- a genuine reorder (same figures, different file) is never falsely flagged.

On a match it returns `409 BILL_DUPLICATE_POSTING` with a reference to the existing bill and document, and records the draft on the bill so an override retry finishes it rather than creating another. A reviewer can confirm again with `allowDuplicate: true` to record it anyway (the sanctioned "explicit confirmation" policy — we warn rather than incorrectly reject a legitimate transaction). The rule that AI extraction never auto-posts is untouched: confirmation still posts a human-reviewed payload through the identical purchase/sales schema and services.

**Files changed**
- `backend/src/modules/bills/bill.service.js` — `confirm()` duplicate-posting check; `postingSignature`, `findDuplicatePostedBill`; `allowDuplicate` param.
- `backend/src/modules/bills/bill.validation.js` — `allowDuplicate` on the confirm schema.
- (`Bill.checksum` from M3 is reused; no additional migration.)

**Tests added (M3 + M4)**
- `backend/tests/integration/bill-duplicate.test.js` (9) — M3: duplicate refused with reference; `allowDuplicate` keeps both; different file not a duplicate; re-upload after cancel allowed; tenant isolation; concurrent uploads stay consistent. M4: a second IN bill from the same file with a different number is blocked then override-posted; a genuinely different invoice on the same file is **not** flagged; a second OUT bill (auto-numbered sale) from the same file is blocked.

---

## Migration safety

One migration: `backend/prisma/migrations/20261014052105_bill_checksum/migration.sql`.

```sql
ALTER TABLE "bills" ADD COLUMN "checksum" TEXT;
CREATE INDEX "bills_companyId_checksum_idx" ON "bills"("companyId", "checksum");
```

- **Additive and non-destructive.** A nullable column with no default (existing rows stay valid and are not rewritten) plus one index. Nothing is dropped and no data is modified.
- **Drift removed.** `prisma migrate dev` also wanted to emit unrelated foreign-key `onDelete` changes and a dropped index, caused by **pre-existing drift** between `schema.prisma` and the migration history (not introduced by this work). Those were removed from the migration so it stays scoped to M3; the pre-existing drift is left exactly as it was.
- **Applied to:** the dev DB via `prisma migrate deploy`, and the test DB (which is `db push`-managed and returns P3005 for `deploy`) via `prisma db execute` of the same additive SQL. Verified the `checksum` column is present on both. `prisma generate` was re-run.

---

## Tests run & results

- **Backend unit — H1 calculator:** `tests/unit/purchase-return-calculator.test.js` — 10 passed.
- **Backend integration — targeted:** purchase-return-discount (5), purchase-returns (49, unchanged), money-transfer-idempotency (5), money-accounts (16, unchanged), bill-duplicate (9), bills (27, unchanged), bill-ai-hardening (17, unchanged), bill-matching (13, unchanged) — all passed.
- **Full backend suite (`npm test`):** 69 files / 1863 tests passed, exit 0 (264s) — up from 65/1834 before this work (+4 files, +29 tests, all added here; nothing regressed).
- **business-web typecheck (`tsc --noEmit`):** PASS (exit 0, no type errors).
- **business-web tests (`npm test`):** 19 files / 225 tests passed (exit 0).

Each original defect has a test that reproduces it (asserts the corrected amount / single record / 409 reference) and would fail against the pre-fix code.

---

## Remaining risks / accepted limitations

1. **M4 — different-file, different-number duplicate.** If the same invoice is re-photographed (different pixels → different checksum) *and* given a different invoice number, it is not auto-detected — reliable identification is genuinely impossible there, and the brief explicitly prefers not to reject legitimate transactions. The same-number case remains hard-blocked by the document-layer uniqueness; the same-file case is caught by M4; this residual is the documented gap.
2. **M3 — concurrent identical uploads.** Detection is a company-scoped pre-check, not a DB unique (a hard unique would wrongly block intentional re-uploads and multi-invoice files, which legitimately share bytes). Two truly simultaneous identical uploads could both pass the check in a small race window; the only cost is one extra extraction job, and the authoritative protection against the real harm — double *posting* — is M4 plus the document-layer uniqueness. The test asserts the endpoint stays consistent and that sequential duplicates are reliably caught.
3. **M4 enforcement layer.** The content-signature check runs in the confirm request just before posting, not inside the posting transaction (bill orchestration spans two services). The in-transaction, DB-backed guarantee for the common case is the existing invoice-number uniqueness; the new check adds the warning for the blank/differing-number case.
4. **Pre-existing schema drift** (FK `onDelete`, a dropped index) remains unmigrated, as it was before this work. Worth a separate, dedicated migration later; deliberately not bundled here.
