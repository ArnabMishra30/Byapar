# Byapar Shop Owner User Guide — Verification Report

Prepared while finalizing `SHOP_OWNER_USER_GUIDE.tex`. Every workflow in the
manual was checked against the **actual application** (frontend routes, backend
services, validation and permissions), and all 15 screenshots were captured from
the **real running app**.

---

## 1. Workflow verification checklist

Legend: **VERIFIED** (works and matches the manual) · **PARTIAL** (core verified,
one aspect not exercised here) · **NOT IMPLEMENTED** · **NOT TESTED**.

| # | Workflow | Status | Notes |
|---|----------|--------|-------|
| 1 | Login & dashboard | **VERIFIED** | Logged in as the demo Shop Owner; dashboard renders. |
| 2 | Products & product creation | **VERIFIED** | Fields confirmed in the product form: name, item code/SKU, barcode, category, unit, GST/HSN (GST shops), purchase price, selling price, minimum stock, description. |
| 3 | Opening stock | **VERIFIED** | Recorded via a purchase / Stock In; stock then moves automatically. |
| 4 | Inventory & stock adjustments | **VERIFIED** | Stock Dashboard, Stock In/Out, Stock Adjustments, Low Stock all present. |
| 5 | Unified Parties | **VERIFIED** | One `Party` with independent customer/supplier sides; balances never netted (confirmed in service + statement code). |
| 6 | Quick Billing | **VERIFIED** | Party picker, auto price-fill from selling price, Full/Part/On-credit payment, Into-account, Save draft / Save & complete. |
| 7 | Sales & invoices | **VERIFIED** | Draft → post; invoice list, payment status, print/download. |
| 8 | Purchases & purchase bills | **VERIFIED** | Purchase rate/discount; completing adds stock (weighted-avg cost) and a payable. |
| 9 | Sales & purchase returns | **VERIFIED** | Return modules exist; stock and party balances adjust. |
| 10 | Money Received | **VERIFIED** | Dialog shows auto-allocation ("applied to oldest bills first") + **Record payment** / Save draft. |
| 11 | Money Paid | **VERIFIED** | Mirror of Money Received for suppliers. |
| 12 | Credit Book & Payables | **VERIFIED** | Credit Book (receivables) and Payables (what you owe, which bills are due). |
| 13 | Party statement | **VERIFIED** | Running receivable + payable side by side; PDF & Excel downloads (server-side). |
| 14 | Party payment allocation | **VERIFIED** | Amount auto-applies oldest-first; manual per-bill override; leftover kept as advance. |
| 15 | AI Bill Import | **PARTIAL** | Upload/review/confirm flow and the discount-into-purchase logic are verified in code; the **live AI extraction was NOT TESTED** on the local instance (no `LLAMA_API_KEY` set locally). The upload/start screen was captured; the "review a read bill" screen needs the AI service. |
| 16 | Expenses | **VERIFIED** | Expense categories; paid-from account; distinct from supplier payment. |
| 17 | Cash & Bank | **VERIFIED** | Account balances; transfers; updated by every receipt/payment/expense. |
| 18 | Reports | **VERIFIED** | Sales, Purchases, Stock, **Parties** (unified owes-you/you-owe/net), Expenses, Profit & Loss; date range + Print/Download/Share. |
| 19 | PDF & Excel exports | **VERIFIED** | Party statement renders real PDF (pdfmake) and Excel (exceljs) server-side. |

**Totals:** Verified **18** · Partial **1** · Not implemented **0** · Not tested **0**
(one aspect of #15 — live extraction — not exercised locally).

### Not implemented (correctly described as limitations, not features)
- **Stock transfer between stores** — not in the app; the guide tells shops to use
  Stock In/Out at each store instead.

---

## 2. Screenshots

**Captured: 15 / 15.** All taken from the real running application — the seeded
demo shop ("Amazing Enterprises", GST off), signed in as the Shop Owner
(`owner@demoshop.test`) — at **1440×900, retina (2×)**, no browser chrome, demo
data only (no real credentials or private numbers). Saved to
`docs/user-guide/screenshots/` with the exact filenames the guide references.

| File | Screen | Note |
|------|--------|------|
| 01-login.png … 12-credit-book.png | Login, dashboard, sidebar, add product, stock dashboard, add party, party list, quick billing, new sale, new purchase, money received, credit book | Live screens; sidebar shows current wording (e.g. **Payables**). |
| 13-bill-import.png | Bill Import start/upload screen | Real screen; the live "reviewed bill" screen needs the AI service (see #15). |
| 14-reports.png | Reports → **Parties** (unified report) | Shows the tab row and the unified owes-you / you-owe view. |
| 15-party-statement.png | **XYZ Traders** statement | A both-sided party, so it shows running receivable **and** payable. |

**Missing: 0.** (The money-received shot shows the dialog with the auto-allocation
note and Record-payment button; a fully staged per-bill allocation was attempted
but not used, as it is not needed to explain the feature.)

---

## 3. LaTeX compilation

- **Not compiled in this environment** — the machine has no LaTeX engine
  (`xelatex`/`lualatex`/`pdflatex`/`tectonic` all absent). The author will compile
  on **Overleaf** (confirmed).
- **Static audit performed and clean:** no Markdown syntax in the LaTeX, no
  unescaped specials, `\begin`/`\end` balanced (74/74), required TikZ libraries
  loaded (`calc`, `arrows.meta`), robust (non-font-dependent) arrow/minus glyphs,
  `\@starttoc` used for the contents heading, and **all 15 `\shot{}` references
  resolve to real image files**.
- **Engine:** XeLaTeX (uses `fontspec`; the ₹ glyph is drawn from DejaVu Sans).
  Compile **twice** for the TOC and cover banner. `README.md` has the steps.

---

## 4. Final PDF page count

- **Estimated ~45–55 A4 pages** (17 chapters, 15 figures, callouts and tables).
  An exact count needs the compile, which runs on Overleaf.

---

## 5. Remaining limitations / things that genuinely need you

1. **Compile the PDF** on Overleaf (XeLaTeX, compile twice) to produce
   `SHOP_OWNER_USER_GUIDE.pdf`. Everything else is in place.
2. **AI Bill Import "review" screenshot (optional):** figure 13 shows the upload
   screen. If you want the live "reviewed bill" screen, it needs `LLAMA_API_KEY`
   enabled and a sample bill uploaded — then re-capture `13-bill-import.png`.
3. **Support contact:** the guide points to your landing page, since the support
   email/phone come from environment config rather than the code.
4. **Minor app wording (not a doc issue):** the Money Received dialog field is
   still labelled "Customer" in the app (the party rename hasn't reached that one
   label). Left untouched here — this is an application change, outside the scope
   of finishing the manual.
