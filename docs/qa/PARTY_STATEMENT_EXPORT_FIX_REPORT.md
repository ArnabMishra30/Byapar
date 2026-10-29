# Party Statement PDF/Excel — fix report (reference match + ledger semantics)

**Date:** 2026-10-27
**Trigger:** review comparing `PartyReport(1).pdf` (Vyapar reference) with `statement-XYZ-Traders.pdf` (first implementation). Two problems: (a) the "Txn Balance" column showed a figure that a *later* payment had changed, sitting confusingly next to a correct historical running balance; (b) the PDF layout was too sparse versus the reference.

This was a **targeted fix**, not a rebuild. No accounting entries, schema, or production data were changed.

---

## 1. The semantics bug and the fix

**Observed (before):** the purchase row showed **Txn Balance ₹15,000** while its **running Payable** was **₹20,000**, with a ₹5,000 supplier payment 16 days later. The ₹15,000 was the document's *live* outstanding (after the later payment) — so an earlier row appeared to have been changed by a later transaction.

**Root cause:** the running receivable/payable were already correct (chronological, never netted, not altered by later rows). But `Txn Balance` was being set to the document's **current** `outstandingAmount`, which reflects allocations made at any later date.

**Decision (intended semantics), now documented on the statement itself:**

| Field | Meaning |
|---|---|
| **Total** | The document's gross value (invoice/bill grand total, or payment amount). |
| **Received / Paid** | Money received (receipt) or paid (payment) on that row. Blank for invoices/bills. |
| **Txn Balance** | The transaction's **own amount when it posted** — for an invoice/bill, its full value; for a payment, the unallocated (advance) part. **Never changed by a later row.** |
| **Receivable Balance / Payable Balance** | The **running** totals in date order, as of that row. A later payment moves the balance on **its own row**, never an earlier one. The two sides are never netted. |
| **Outstanding (now)** | The document's **live** open amount after all allocations — reported **distinctly** (its own column in Excel, an italic line under the item table in the PDF, `currentOutstanding` in JSON), so it is never confused with the chronological figures. |

**Result (after), XYZ Traders demo:**

| Date | Type | Total | Txn Balance | Outstanding (now) | Receivable | Payable |
|---|---|---|---|---|---|---|
| 2026-09-10 | Purchase | ₹20,000 | **₹20,000** | ₹15,000 | ₹0 | ₹20,000 |
| 2026-09-18 | Sale | ₹8,000 | **₹8,000** | ₹6,000 | ₹8,000 | ₹20,000 |
| 2026-09-24 | Payment In | ₹2,000 | ₹0 | — | ₹6,000 | ₹20,000 |
| 2026-09-26 | Payment Out | ₹5,000 | ₹0 | — | ₹6,000 | ₹15,000 |

Txn Balance now equals the transaction's own amount and matches the running balance at that row; the live ₹15,000 / ₹6,000 appear only under "Outstanding (now)". This matches the reference, where a Sale's Txn Balance equals its Total.

Single source of truth: the change is in `party-statement.service.js` only, so JSON, PDF, Excel and the web table all agree automatically.

---

## 2. PDF layout changes (`party-statement.pdf.js`)

- **Portrait A4** (was landscape), to mirror the reference.
- Business header (name bold, address, phone/email, GSTIN/State) + horizontal rule; **centred, underlined "Party Statement"** title; party/period block.
- Full-width ledger with a **shaded header row** and wrapped two-line headers ("Received / Paid", "Receivable Balance", "Payable Balance"); compact rows; running-balance columns bolded.
- **Item-detail table under each sale/purchase/return**: #, Item name, HSN/SAC, Qty, Price/unit, Discount, Tax, Amount, with a **Total** (qty + amount) row and a **Sub Total** row (plus Tax / Grand Total when GST applies) — the reference's foot.
- **"Outstanding now on this bill/invoice: ₹X"** printed in italic beneath the item table, only when it differs from the total.
- A one-line **legend** defining Txn Balance vs the running balances.
- Repeated header on every page (`headerRows`), rows kept whole, **page numbers** in the footer, consistent margins.
- Currency: `₹ 1,03,065.00` (Indian grouping), Roboto (ships the ₹ glyph). No logo is drawn — the `Company` model has no logo field; business name/details come from config, never hardcoded.

The regenerated sample (`statement-XYZ-Traders-fixed.pdf`) was **visually inspected** against the reference: hierarchy, shaded header, item tables, totals, legend and summary all present and aligned; no clipped amounts or overlapping columns.

## 3. Excel changes (`party-statement.xlsx.js`)

- Party Statement sheet gains a distinct **"Outstanding (now)"** column, with the running columns renamed **"Receivable (running)" / "Payable (running)"**; Txn Balance carries the corrected (own-amount) value.
- Unchanged and retained: three sheets (Party Statement, Line Items, Summary), numeric ₹ cells (`"₹" #,##,##0.00`), real dates, frozen header rows, auto-filters, sensible widths, separate receivable/payable totals.
- PDF and Excel read the same statement object, so they agree for the same filters and date range.

## 4. Frontend (`party-statement.tsx`, `lib/api/parties.ts`)

- `StatementLine` gains `currentOutstanding`.
- Column headers renamed to **Receivable Balance / Payable Balance**; Txn Balance header tooltip now reads "the transaction's own amount when it posted — not changed by later payments".
- The expanded item detail shows **"Outstanding now on this bill/invoice: ₹X (as of today, after later payments)"** when it differs from the total.

---

## 5. Tests run and results

- **Statement integration + renderer unit tests:** `vitest run tests/integration/party-statement.test.js tests/unit/party-statement-pdf.test.js` → **21 passed.**
- **Full backend suite:** `vitest run` → **74 files, 1909 tests passed.**
- **business-web:** `tsc --noEmit` clean; `vitest run` → **225 passed.**

New / updated coverage for the review's list:
1. Purchase → later supplier payment: the purchase's Txn Balance stays its own amount (₹5,000 in the test), the running payable at that row stays ₹5,000, and `currentOutstanding` reflects the later payment (₹3,000) — **a later payment never changes an earlier row**.
2. Sale → later customer receipt: same, on the receivable side.
3. Partial and full allocations (partial receipt/payment; status PARTIAL/SETTLED).
4. Receivable and payable outstanding simultaneously, never netted.
5. Returns (each reduces only its side), advances, and windowed opening balances.
6. Date-range boundaries (`toDate` inclusive); dates stored at UTC midnight.
7. **Historical running balance vs current document outstanding** — the explicit new test above.
8. PDF (`%PDF-`, headers) and XLSX (`PK`, 3 sheets, **Outstanding (now)** header present) totals/counts; Line Items row count reconciles to the statement (overall and under a type filter).
9. **Multi-page PDF**: renderer test asserts ≥ 2 pages for a long statement (with repeated headers and item tables).
10. Tenant isolation: another company's statement / PDF / Excel all 404; platform user blocked.

## 6. Sample exports (same test data)

Generated from the live demo (party **XYZ Traders**, owes you ₹6,000 / you owe ₹15,000):
- `statement-XYZ-Traders-fixed.pdf` — the corrected, reference-matching PDF (inspected).
- `statement-XYZ-Traders-fixed.xlsx` — the corrected workbook.
- Re-downloadable any time from the running app at `/shop/parties/<id>/statement` → PDF / Excel.

## 7. Remaining limitations

- **No logo** in the PDF header: the `Company` model has no logo/image field. Business name, address, phone, email and GSTIN come from configuration. (Add a `Company.logoUrl` later to render one.)
- The PDF stays **portrait** and can get dense when GST tax columns and very long item names combine; widths were tuned to avoid clipping, but an extreme case (many long item names) may wrap. Item name is the only wrapping column by design.
- "Outstanding (now)" is a convenience read of the document's current receivable/payable; it is a live figure and will change as new payments post — that is its intended meaning and it is labelled as such.
- Inventory accounting and posted entries were not touched.
