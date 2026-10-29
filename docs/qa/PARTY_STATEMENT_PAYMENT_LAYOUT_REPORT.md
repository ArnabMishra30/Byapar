# Party Statement — payment details in the ledger

**Date:** 2026-10-29
**Goal:** render payment method and payment metadata directly beneath each dated payment row in the one chronological ledger (as the Vyapar reference shows "Payment Type: Cash" under a payment), in both the PDF and the Excel export — using real stored data.

**Method:** the PDF was rendered to page images and inspected. Sample: `scratchpad/short-XYZ.pdf` (a cash receipt and a bank-transfer payment, with allocation and notes), plus `scratchpad/long-synthetic.pdf` (multi-page, mixed modes, some with an unused advance).

---

## 1. Data — no schema change needed

Payment method, reference and notes are **already persisted**: `CustomerPayment` and `SupplierPayment` carry `paymentMethod` (enum), `referenceNumber`, `notes`, plus `allocatedAmount` / `unallocatedAmount` and per-document `allocations`. **No migration** was required; nothing fabricates a method or reference.

- `party-statement.repository.js` — added `notes` to the two payment selects (method/reference/allocations were already fetched).
- `party-statement.service.js` — each **payment** line now exposes a `payment` block: `{ mode, modeLabel, reference, notes, allocated, unallocated, allocations[] }`. A `PAYMENT_MODE_LABEL` map turns the stored enum (`CASH`, `BANK`, `BANK_TRANSFER`, `UPI`, `CHEQUE`, `OTHER`) into a readable label; an unknown/absent mode shows **"Not specified"**. The metadata never touches any balance.

## 2. Chronological ledger (unchanged, confirmed)

All transactions — sales, purchases, receipts (Payment In), supplier payments (Payment Out), sales returns, purchase returns — are one ledger sorted by `(entryDate, createdAt, id)`. That tiebreak gives a **deterministic order for multiple transactions on the same date** and is documented in the service. Payments are inline rows, not a separate end section.

## 3. PDF — payment metadata beneath each payment row

`party-statement.pdf.js` adds `paymentMetaBlock(line)`: immediately after a payment row it renders, indented and in a muted tone, up to four short lines, before the next dated transaction:

- `Payment mode: <label>` (+ `Reference: <ref>` when present)
- `Allocated to invoices: ₹X` (+ `Unused advance: ₹Y` when there is an advance)
- `Against: <doc> ₹…, <doc> ₹…` (the invoices/bills the payment was applied to)
- `Notes: <notes>` (when present)

Only the fields that exist are shown. Verified in the rendered image: the cash receipt shows mode + allocation + "Against: INV-…", and the bank-transfer payment shows mode + "Reference: UTR-5512" + allocation + "Notes: Monthly settlement". The reference's gray header, item tables, compact rows, separators, repeated headers and page numbers are preserved.

**Pagination:** the metadata sits in a full-width row right beneath its payment row. As in the Vyapar reference itself (which splits "Payment Type: Cash" onto the next page in its own sample), pdfmake can place the metadata on the following page when a payment lands at the very bottom of a page; the block is kept compact to make that rare. A hard "never split" guarantee is not available for two separate table rows in pdfmake without breaking column alignment; this is the one accepted limitation.

## 4. Excel — payment columns

`party-statement.xlsx.js` — the Party Statement sheet gains five columns, populated for payment rows only: **Payment Mode, Payment Ref, Allocated, Unused Advance, Notes** (the money ones as numeric ₹ cells). Transactions stay chronological; receivable/payable running columns stay separate; frozen header and auto-filter now cover all 15 columns. PDF and Excel read the same `payment` block, so they agree.

## 5. Web statement (consistency)

`features/party-master/party-statement.tsx` shows a small detail row beneath each payment: `Payment mode: … · Ref: … · Allocated … · Unused advance … · Notes: …`, from the same API field.

## 6. Balances (unchanged, re-asserted)

Payment In reduces the receivable; Payment Out reduces the payable; neither is netted against the other, and a payment's method/metadata never affects a calculation. The statement keeps **payment amount** (Total/Received-Paid), **allocated** vs **unused advance** (the payment's own balance / Txn Balance), and the independent **running receivable/payable** all distinct.

## 7. Tests and results

Added to `tests/integration/party-statement.test.js` (and the PDF unit test now renders a payment row):

1. **Cash receipt** — mode `CASH`/"Cash", reference, notes and allocation surface beneath the row.
2. **Supplier payment by bank transfer** — mode `BANK_TRANSFER`/"Bank transfer", reference; notes null when absent.
3. **Unallocated advance** — `allocated` and `unallocated` reported distinctly, status `UNUSED`, and the advance is the payment's own Txn Balance.
4. **Excel** contains the `Payment Mode` column with "Cash" for a cash receipt.
5. Existing coverage still holds: multiple-same-date ordering (deterministic tiebreak), partial allocation, running receivable/payable correctness, multi-page PDF (≥2 pages), tenant isolation (another company → 404), and PDF/Excel/JSON agreement.

Results:
- `vitest run tests/integration/party-statement.test.js tests/unit/party-statement-pdf.test.js` → **25 passed** (22 integration + 3 unit).
- **Full backend suite** → green (see run log); **business-web** `tsc --noEmit` clean.

## 8. Missing legacy data / limitations

- Older payments created before this feature already have a `paymentMethod` (it is a required enum), so the mode always shows; `referenceNumber`/`notes` appear only where the shop entered them (otherwise omitted). Nothing is invented.
- The payment metadata row can be separated from its payment row by a page break in rare bottom-of-page cases (same as the reference); kept compact to minimise.
- No posted accounting entry, schema or production data was changed.
