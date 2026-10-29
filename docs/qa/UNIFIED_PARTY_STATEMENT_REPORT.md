# Unified Parties + Vyapar-style Party Statement — implementation report

**Date:** 2026-10-27
**Scope:** one Parties module (no Customer/Supplier/Both choice at creation) and a reliable, downloadable Vyapar-style Party Statement (PDF + Excel) with independent receivable and payable ledgers.

---

## 1. Summary of outcome

- A party is now created **without choosing a type**. An owner's new party becomes **both** a customer and a supplier at once, so it is usable in sales and purchases immediately; a cashier (no `PARTIES_MANAGE`) still gets the customer side only. The two balances stay independent and are never netted.
- **Parties is the single place** the shop manages the people it deals with. The separate **Customers** and **Suppliers** navigation menus were removed (their pages still exist and open from a party's profile and from documents). Credit Book moved under Parties.
- A new **Party Statement** merges both sub-ledgers into one chronological ledger with **two independent running balances**, per-document item detail, and payment status — served as JSON and as real **server-side PDF and `.xlsx`** downloads.
- **No schema change and no migration.** The feature is built entirely on the existing `Party` / `Customer` / `Supplier` models and the existing customer/supplier sub-ledgers. No production data is touched.

---

## 2. Files changed

### Backend (`backend/`)
| File | Change |
|---|---|
| `package.json` / `package-lock.json` | Added `pdfmake ^0.2.10` and `exceljs ^4.4.0` (pure-JS, no headless browser). |
| `src/modules/parties/party.validation.js` | `relationship` made optional on create; new `partyStatementQuerySchema` (date window, `type`, `search`, `includeItems`). |
| `src/modules/parties/party.service.js` | `create()` defaults relationship to `BOTH` (owner) / `CUSTOMER` (cashier) when none is sent; still honours an explicit relationship. |
| `src/modules/parties/party-statement.repository.js` | **New.** Reads (only) the documents behind the ledger rows — totals, payment status, item rows, payment allocations — one query per document type. |
| `src/modules/parties/party-statement.service.js` | **New.** Merges the customer and supplier sub-ledgers into one chronological statement with independent running receivable/payable, windowed opening balances, per-document detail, type/search filtering and a period summary. |
| `src/modules/parties/party-statement.pdf.js` | **New.** Renders the statement to a PDF (pdfmake): landscape A4, repeated table header, page numbers, item sub-tables, ₹ Indian grouping, final summary. |
| `src/modules/parties/party-statement.xlsx.js` | **New.** Renders a genuine 3-sheet `.xlsx` (exceljs): Party Statement, Line Items, Summary — numeric ₹ cells, real dates, frozen header rows, auto-filters. |
| `src/modules/parties/party.controller.js` | `statement` now returns the unified statement; new `statementPdf` / `statementExcel` set content types, `Content-Disposition` and a sanitised filename. |
| `src/modules/parties/party.routes.js` | `GET /:id/statement` validated by the new schema; new `GET /:id/statement.pdf` and `GET /:id/statement.xlsx` (both `REPORTS_VIEW`). |
| `tests/integration/parties.test.js` | Updated the one behaviour that changed on purpose: creating a party with no relationship now succeeds as `BOTH` (was a 400). |
| `tests/integration/party-statement.test.js` | **New.** 17 integration tests (see §8). |

### Business web (`business-web/`)
| File | Change |
|---|---|
| `src/features/party-master/party-master-form.tsx` | Removed the "Who are they to you?" Customer/Supplier/Both cards. A new party is simply a party. |
| `src/features/party-master/party-payload.ts` | Default form relationship is `BOTH`. |
| `src/features/party-master/party-profile.tsx` | Added a **Statement** action (gated on `reports.read`) linking to the new page. |
| `src/features/party-master/party-statement.tsx` | **New.** The statement page: filters (date range / type / reference search / item toggle), two separate balance cards, the merged ledger with expandable item rows, Print, Download PDF, Download Excel. No money arithmetic client-side. |
| `src/app/shop/(app)/parties/[id]/statement/page.tsx` | **New.** Route for the statement page. |
| `src/lib/api/parties.ts` | New `statement()` and `statementFile(format)` (blob) methods and `PartyStatement` / `StatementLine` / `StatementItem` / `StatementParams` types. |
| `src/lib/constants.ts` | Navigation collapsed to a single **Parties** section (All Parties, Add Party, Credit Book); removed the Customers and Suppliers sections. Added `DETAIL_ROUTES.partyStatement`. |
| `src/__tests__/foundation.test.tsx` | Nav-coverage test updated: `/shop/customers` and `/shop/suppliers` are no longer required in the sidebar (their pages still exist). |

---

## 3. Schema & migration

**None.** The `Party`, `Customer`, `Supplier`, `CustomerLedgerEntry`, `SupplierLedgerEntry`, receivable/payable and payment/allocation models already existed and already keep the two sides independent. This feature adds **read** endpoints and export rendering only. No Prisma migration was created or run; existing record IDs, invoice references, allocations, stock movements, GL entries and audit fields are untouched.

---

## 4. API changes

Under `/api/v1` (all require auth; the three statement routes require the `REPORTS_VIEW` shop permission; tenant is always taken from the session):

- `GET /parties/:id/statement` — **behaviour changed.** Now returns the unified statement (merged ledger, two running balances, per-document items, summary). This endpoint had **no prior test coverage and no frontend consumer** (per-side statements are served from `/customers/:id/statement` and `/suppliers/:id/statement`, which are unchanged).
- `GET /parties/:id/statement.pdf` — **new.** Streams the PDF with `Content-Type: application/pdf` and an `attachment` filename.
- `GET /parties/:id/statement.xlsx` — **new.** Streams the workbook with the spreadsheet content type and an `attachment` filename.
- `POST /parties` — `relationship` is now **optional** (back-compatible: explicit `CUSTOMER`/`SUPPLIER`/`BOTH` still work).

Query params for all three statement routes: `fromDate`, `toDate` (`YYYY-MM-DD`), `type` (`ALL|SALES|PURCHASES|RECEIPTS|PAYMENTS|RETURNS`), `search` (reference/number substring), `includeItems` (`true`/`false`). Downloads reuse the same data and respect the same filters.

---

## 5. Accounting calculation rules (how balances are derived)

- Every line is an existing entry in the **customer or supplier sub-ledger**, written inside the posting transaction of its document. Drafts and cancelled documents never reach a sub-ledger, so they cannot appear.
- The two sub-ledgers are merged into one list sorted by **(entryDate, then createdAt, then id)** — deterministic and stable.
- **Running receivable** `+= (customer debit − customer credit)`; **running payable** `+= (supplier credit − supplier debit)`. They are advanced independently; a receipt only moves the receivable, a supplier payment only moves the payable. **Nothing is ever netted.**
- A **windowed** statement (`fromDate` set) folds all earlier movement into the opening receivable/payable (via the existing `*BalanceBefore` reads), so the closing figures are the party's true position. `toDate` is inclusive.
- `type` and `search` filter **which rows are returned**; the running-balance figure shown on each surviving row is still the true running value computed over the whole window. The period **summary** (closing balances, totals) is always over the full window, never the filtered subset.
- Per-document **payment status** and **outstanding** are read from the document's receivable/payable (`PAID`/`PARTIAL`/`UNPAID`/`CREDITED`), and for payments from the unallocated amount (`UNUSED`/`SETTLED`). All money is `Decimal` in the service and serialised as fixed-2-dp strings; the frontend never recomputes it.

---

## 6. PDF export

- Generated server-side with **pdfmake** from the statement data (not a screenshot). Fonts are Roboto, decoded from the copy pdfmake ships — Roboto carries the ₹ glyph, so Indian currency prints correctly with no vendored font files.
- Landscape A4; the 9-column ledger header **repeats on every page** (`headerRows`), rows never split, a page number prints in the footer.
- Each sale/purchase/return row can carry an **item sub-table** (serial, item, HSN/SAC, qty, price, discount, tax, amount) with a subtotal/total foot.
- Currency is formatted `₹ 1,03,065.00` (Indian lakh grouping, two decimals). A final summary lists receivable, payable, advances and period totals **separately**. Respects the active `type`/`search`/date filters and `includeItems`.

## 7. Excel export

- Genuine `.xlsx` via **exceljs** (not CSV renamed). Three sheets:
  - **Party Statement** — business + party header, optional opening balances, the ledger with numeric ₹ cells (`"₹" #,##,##0.00`), real dates, a closing row, **frozen header row** and an **auto-filter**.
  - **Line Items** — one row per item across every document, with its document date/type/number.
  - **Summary** — business, party, period and the receivable / payable / advances / period totals, as numeric cells.
- Numbers are stored as numbers (summable/filterable), dates as dates. Respects the active filters; a test asserts the Line Items row count reconciles to the statement's item count under a filter.

---

## 8. Tests run and actual results

- **Backend full suite:** `npx vitest run` → **73 files, 1905 tests, all passing** (~314s). Includes the new `party-statement.test.js` (17 tests) and the updated `parties.test.js`.
- **business-web:** `npx vitest run` → **19 files, 225 tests, all passing**; `npm run typecheck` (`tsc --noEmit`) → **clean**.

New backend statement tests cover:
1. Create a party with no type → `BOTH`, both sub-records present; explicit relationship still honoured.
2. The same party used in both a sale and a purchase → one merged statement.
3. Independent balances: a partial **receipt** reduces only the receivable; a partial **supplier payment** reduces only the payable; both balances coexist; the receipt row shows the payable **unchanged** (proof nothing is netted).
4. Per-document item detail and payment status (`PARTIAL`, `SETTLED`, `txnBalance`).
5. Type filter and reference search leave the running balances and summary intact.
6. `includeItems=false` omits item rows.
7. Sales return and purchase return each reduce only their own side.
8. Draft documents never appear.
9. Windowed opening balance folds earlier movement; `toDate` boundary is inclusive.
10. **PDF** download: `%PDF-` header, `attachment` disposition, non-trivial size.
11. **Excel** download: `PK` header, three sheets, Line Items row count reconciles to the statement (overall and under a type filter).
12. Tenant isolation: another company's statement / PDF / Excel all return **404**; a platform user is blocked.

Export rendering was additionally smoke-tested on a 60-row statement (multi-page PDF ≈ 89 KB; valid `.xlsx`).

---

## 9. Remaining limitations / notes

- **Customers/Suppliers still exist as routes** (`/shop/customers`, `/shop/suppliers`, their `[id]` pages, bulk customer import). They are no longer in the sidebar but remain reachable from a party's "Full account" link and from sale/purchase documents, so existing workflows keep working. The list routes could later be redirected to `/shop/parties` if desired.
- **Reports → Customer Reports / Supplier Reports** were left in place (they are analytics screens, not the party-management surface).
- The party **profile** keeps its existing per-side statement tabs in addition to the new unified Statement page; these could be consolidated later.
- Opening receivable/payable balances on the statement come from the existing ledger (opening-balance journal entries); the party create form still only records an opening balance "for reference" as before — bringing an old balance into the books remains the existing Accounting → Opening balance workflow (unchanged by this task).
- Inventory accounting was not modified.
- No commit/push was made; all changes are in the working tree.
