# Unified Parties — legacy-classification cleanup, seed, and dev-data reset

**Date:** 2026-10-29

One Party concept, usable for both buying and selling, with no customer/supplier/both classification in the shop UI. A comprehensive 6-party seed was written and **verified against the test database**. The local dev-data reset itself was **not performed** — see §5.

---

## 1. Schema changes

**None.** The model was already unified in earlier work: `Party` is the canonical identity; `Customer`/`Supplier` are internal compatibility records (one each, nullable, created automatically). A party with no type is created as **both** sides, so every party can buy and sell; receivable and payable stay independent and are never netted. No migration was added and no migration file was changed.

## 2. Files changed (this task)

| File | Change |
|---|---|
| `business-web/src/features/party-master/parties-page.tsx` | Removed the Customers/Suppliers/Both filter tabs, the **Type** column and the relationship badge (desktop + mobile card) and the per-type counts query. Kept: All Parties, search, active/inactive filter, Party, Mobile, Owes You, You Owe, Last Activity, Status, Open. |
| `business-web/src/components/shared/entity-select.tsx` | Sale/purchase picker now says **"Choose party"** / **"Add new party"** (was "customer"/"supplier"). Both pickers already list all parties, so a party used only for purchases is selectable in a sale and vice-versa. |
| `business-web/src/components/shared/quick-add-party.tsx` | "Add new party" from a bill now creates a party **with no type** (backend makes it both sides for an owner, customer-only for a cashier), so it is immediately usable and never a duplicate. Labels say "party". |
| `business-web/src/features/documents/config.ts` | Sale and purchase forms label the party field **"Party"** (was "Customer"/"Supplier"). |
| `business-web/src/features/documents/party-filter.tsx` | Filter placeholder/aria now **"All parties"**. |
| `backend/prisma/seed-demo-unified.js` | **New.** The comprehensive 6-party seed (see §6). |
| `backend/package.json` | Added `seed:demo:unified`. |
| `backend/tests/integration/unified-party-seed.test.js` | **New.** Verifies the seed: every party is both sides, exact independent balances, F is multi-transaction. |

Already in place from earlier work (unchanged here): the Add Party form has no type selection; Parties is the only nav entry (no Customers/Suppliers menus); the party detail page shows both balances, sales/purchases/receipts/payments/returns, credit book, a date-wise statement, and PDF/Excel downloads with payment details beneath payment rows.

## 3. UI changes (summary)

- **Parties list:** no Type column, no Customer/Supplier/Both tabs, no relationship badges. One list of parties with two balance columns.
- **Sales & purchases:** "Choose party" / "Add new party" / party field label "Party". Selection dialogs query the unified party list; a new party added inline is created with no type and is usable for both directions.
- No `CUSTOMER`/`SUPPLIER`/`BOTH` is shown as a business classification anywhere in the shop list/selection UI.

## 4. Legacy compatibility decisions

- `Customer` and `Supplier` remain as **internal accounting records** behind foreign keys (receivables, payables, ledgers, allocations). They are resolved/created automatically from the Party; the shop never onboards them separately. The `EntitySelect` still reads `/customers` and `/suppliers` under the hood — but because every party now has both sides, each list contains every party, so the unified behaviour holds without reworking every posting service.
- The role enum and the `/customers` and `/suppliers` API endpoints are untouched (no breaking change); their detail pages still open from a party's profile and from documents.
- **Not exhaustively renamed:** report screens and the Credit Book still use "customer"/"supplier" wording where it describes a receivables/payables view (e.g. "Customer Reports"). These are analytics, not party management or selection; they resolve to the same Party. Renaming them is a follow-up if desired.

## 5. Local database reset — attempted, NOT performed

**The database was NOT reset.** Safety checks (per the task) were run first:

- Connection inspected: `NODE_ENV=development`, `DB_HOST=localhost`, `DB_NAME=pharma_erp`, `IS_LOCAL=true`.
- 32 existing migrations present; a safe reset is `prisma migrate reset` (re-applies them), **not** `db push --force-reset`.

The DB is a verified local, disposable dev database, so the reset was authorized — **but the reset command was blocked by this environment's destructive-action guard** (it reads a full-schema drop as a mass delete). I did not bypass the guard.

**To reset and seed, run these yourself from `backend/` (stop the dev servers first):**

```bash
npx prisma migrate reset --force --skip-seed   # drops data, re-applies the 32 migrations
npm run seed:demo:unified                       # seeds the shop + 6 unified parties
```

`seed:demo:unified` prints the login and a statement link per party. (Nothing was reset or seeded into the dev DB by me; the current dev DB still holds the previous demo data.)

## 6. Seeded parties and transactions (in `seed-demo-unified.js`)

Shop: **Demo Kirana Store** (GST off). Owner `owner@demoshop.test` / `Demo@12345`. Products: Sunflower Oil 15L, Basmati Rice 25kg. Every party is created with **just a name** (no type). All transactions post through the real purchase/sale/return/payment services (valid journal entries, stock integrity, moving-average cost), with deterministic dates and references, repeatable on a fresh DB.

| Party | Transactions | Expected receivable | Expected payable |
|---|---|---|---|
| **A — XYZ Traders** | Purchase 20,000; Sale 8,000; Receipt 2,000 (Cash); Payment 5,000 (UPI) | 6,000 | 15,000 |
| **B — Rahul Store** | Sale 12,000; Purchase 4,000; Receipt 3,500; Payment 1,000 | 8,500 | 3,000 |
| **C — ABC Distributors** | Purchases 30,000 + 15,000; Sale 10,000; partial Payment 20,000 | 10,000 | 25,000 |
| **D — Sharma Traders** | Sale 6,000 (fully received); Purchase 4,000 (fully paid) | 0 | 0 |
| **E — New Party** | none | 0 | 0 |
| **F — Mixed Traders** | 2 purchases, 8 sales, 1 sales return, 1 purchase return, 3 receipts (Cash/UPI/Bank), 1 payment — multi-page | 61,000 | 47,000 |

## 7. Expected vs actual balances

**Verified** by `unified-party-seed.test.js` against the test DB: every party is created as `BOTH` (both sides), and `getPartyStatement().summary` returns closing receivable/payable **exactly** equal to the Expected column above for all six parties — asserted with `toEqual`. The two sides are reported separately (never netted). F has ≥14 ledger entries spanning SALE, PURCHASE, RECEIPT, PAYMENT, SALES_RETURN and PURCHASE_RETURN.

## 8. Tests run and results

- **Backend full suite:** `npx vitest run` → **75 files, 1916 tests passing** (includes the new 3-test seed verification and the earlier party-statement/payment tests).
- **business-web:** `tsc --noEmit` clean; `npx vitest run` → **225 passing** (foundation nav invariants, responsive-shell, party-master, etc. all still green after the list/terminology changes).

Coverage of the task's e2e list: create a party with no type (seed + existing tests); use the same party in sale and purchase (A, F); receive and pay (all); independent balances with no netting (asserted exactly); statement transactions + payment method beneath payment rows in PDF + PDF/Excel agreement (party-statement/payment suites); party selectable regardless of prior direction (both pickers list all parties); no duplicate creation (party-matching + create tests); stock/GL/returns/allocation integrity (posting services' own suites, exercised by the seed); tenant isolation + RBAC (existing party/statement tests).

## 9. Remaining issues / follow-ups

- **Dev DB reset is manual** (blocked by the environment guard) — commands in §5.
- Report screens / Credit Book still use "customer"/"supplier" wording (analytics views; same underlying Party). Rename on request.
- `EntitySelect` still queries `/customers` and `/suppliers` rather than a single `/parties` picker endpoint. It works because every party has both sides; a dedicated unified party-picker endpoint would be a cleaner long-term refactor.
- No posted accounting entry, schema, migration or production data was changed. Nothing was committed or deployed.
