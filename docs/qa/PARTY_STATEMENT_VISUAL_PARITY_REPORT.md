# Party Statement PDF — visual parity report

**Date:** 2026-10-29
**Goal:** make the generated Party Statement PDF closely reproduce the Vyapar-style reference (`PartyReport(2).pdf`) in layout, typography, table density and page use — without changing accounting.

**Method:** the PDF renderer (`backend/src/modules/parties/party-statement.pdf.js`, pdfmake) was rebuilt and the output **rendered to page images and inspected visually at full size** (not just text-extracted). Two samples were generated from the renderer and checked page by page:
- `short-XYZ.pdf` — the real 4-transaction XYZ Traders demo (1 page).
- `long-synthetic.pdf` — 18 transactions with multi-item invoices, GST and non-GST documents, long item names, discounts, taxes, partial payments (4 pages).

(Both are in the session scratchpad; regenerate with `scratchpad/gen-samples.mjs`, or download live from `/shop/parties/<id>/statement`.)

---

## 1. What was wrong before

- **Too sparse / shrunken:** body text was 6.8–7.5pt, so content sat in a small block at the top with large empty space below; it did not read like the reference.
- **No logo** in the header.
- **Landscape** orientation, unlike the portrait reference.

## 2. What changed (renderer rebuild)

Layout now mirrors the reference's information hierarchy:

1. **Logo + business block** — a monogram badge (business initials, e.g. "DK"/"AE") top-left, business name bold top-right with address, phone/email and GSTIN/State right-aligned. (The `Company` model has no logo image field; the monogram stands in — see limitations.)
2. **Horizontal separator** under the business header.
3. **Centred, underlined "Party Statement"** title.
4. **Party block** — party name (bold, prominent), contact number, address, GSTIN, period, generated-at.
5. **Full-width ledger** with a **grey header row**, two-line wrapped headers, and **bold transaction rows**; money right-aligned.
6. **Item-detail table under each sale/purchase/return**, styled like the reference: a compact **6-column** table (#, Item name, HSN/SAC, Quantity, Price/unit, Amount) that expands to **8 columns** (adds Discount, Tax) only when the document actually carries them, with **Total**, **Sub Total**, and (for GST docs) **Tax** / **Grand Total** rows.
7. **"Outstanding now on this bill/invoice: ₹X"** in italics under the item table (kept distinct from the chronological figures).
8. A one-line **legend** defining Txn Balance vs the running balances.
9. **Closing summary** (sales / received / purchases / paid, then receivable and payable in bold).
10. **Repeated ledger and item-table headers** across pages, **page numbers**, consistent margins.

Typography/metrics tuned for readability and page use: portrait A4, 22pt side margins, body 8pt (money 7.5pt so even a ₹-crore running balance fits its column), title 17pt, business name 16pt, comfortable ~4.5pt row padding. Restrained grayscale — no card/dashboard styling.

## 3. Pagination and page use

- Page count now **follows content volume**: the 4-transaction statement is 1 page; the 18-transaction sample is 4 pages; a 39-transaction run is 7 pages. No fixed/forced page count.
- The ledger header **repeats on every page** (verified on pages 2–4 of the long sample); item sub-tables repeat their own header if they split.
- `dontBreakRows` keeps a transaction's main row intact; invoice headers stay with their item tables in the common case.
- A short statement still has white space below its content — that is correct for a genuinely short statement (the content is now readable, not shrunk).

## 4. Column fit (no clipping)

- Ledger columns: Date, Txn Type, Ref No., Payment Status, Total, Received / Paid, Txn Balance, Receivable Balance, Payable Balance — widths deliberately set so the full header text shows and Indian-grouped ₹ amounts up to ~₹1 crore fit without wrapping or clipping. Date and Ref are `noWrap`.
- Item columns support item number, name (wraps across lines), HSN/SAC, quantity + unit, price/unit, discount, tax, amount.
- Fixes verified in the rendered images: the previously clipped **"Payabl Balanc"** header now reads **"Payable Balance"**; the previously wrapped **"2026-01-0 / 2"** date now renders on one line; ₹5,53,185.90 and ₹1,50,621.10 render in full.

## 5. Accounting correctness (unchanged)

No accounting entry, balance rule or data was changed for the PDF. The four concepts stay distinct and come straight from the statement API:
- **Txn Balance** = the transaction's own amount at posting (never rewritten by a later row).
- **Outstanding (now)** = the document's live open amount after allocations (shown separately).
- **Receivable Balance / Payable Balance** = independent running totals in date order.
Receivables and payables are never netted; a later payment moves the balance on its own row. Tenant isolation and `REPORTS_VIEW` authorization are unchanged.

## 6. Excel

The `.xlsx` is unchanged by this pass and already carries the same transactions, the distinct **Txn Balance** / **Outstanding (now)** / **Receivable (running)** / **Payable (running)** columns, numeric ₹ cells, real dates, frozen headers, filters and separate receivable/payable totals. PDF and Excel read the same statement object, so they agree for the same filters and date range (an integration test reconciles the Excel Line-Items row count to the statement).

## 7. Tests and results

- `vitest run tests/integration/party-statement.test.js tests/unit/party-statement-pdf.test.js` → **21 passed** (PDF content-type/headers/`%PDF`, multi-page ≥2 pages, `formatInr` Indian grouping, Excel sheets + reconciliation, accounting-semantics regressions, tenant isolation).
- Full backend suite and business-web typecheck/tests were run after the change (see the run log) and stay green.

## 8. Remaining differences / limitations

- **Monogram, not a real logo:** `Company` has no logo image field. A real uploaded logo needs a `Company.logoUrl` (additive migration + upload flow) — out of scope here; the monogram is the faithful stand-in.
- Money columns render at 7.5pt (vs 8pt body) so nine columns plus large ₹ amounts fit portrait A4 without clipping; a single value above ~₹1 crore in the narrowest money column could still clip (rare for one party).
- Item name is the only wrapping item column; extremely long names wrap to 2–3 lines (as in the reference).
- The reference's exact fonts/brand colours are not reproduced (no third-party branding); the statement uses a restrained grayscale accounting style as instructed.
