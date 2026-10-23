# Phase 3B — Inventory Accounting Report (implementation)

**Date:** 2026-10-15
**Design:** [PHASE_3B_INVENTORY_ACCOUNTING_DESIGN.md](PHASE_3B_INVENTORY_ACCOUNTING_DESIGN.md) (validated; all four decisions confirmed: net discounts · gain → new REVENUE 4200 as other income · reconciliation report-only · defer the Phase-5 return residue).
**Scope delivered:** opening stock, stock adjustments (gain/loss), purchase-discount valuation, and a GL↔sub-ledger reconciliation check — the four areas in the brief. The Phase-5 return residue was deliberately deferred (per the confirmed decision) and is reported, not fixed.
**Honesty note:** every result below was executed this session. No browser or live-provider testing was involved.

---

## 1. Policy implemented & account mappings

Account types are the verified live ones (read from `system-accounts.js`), never assumed.

| Event | Journal entry | Valued at |
|-------|---------------|-----------|
| Opening stock (inventory endpoint) | `Dr 1300 Inventory (ASSET) / Cr 3000 Owner's Capital (EQUITY)` | movement `totalCost` |
| Stock adjustment — increase (found/surplus) | `Dr 1300 Inventory / Cr 4200 Inventory Adjustment Gain (REVENUE, new)` | qty × entered cost |
| Stock adjustment — decrease (damage/loss/shrinkage) | `Dr 5300 Inventory Shrinkage & Loss (EXPENSE, new) / Cr 1300 Inventory` | qty × current moving average |
| Purchase with a line discount | `Dr 1300 Inventory (NET) + Dr Input tax / Cr 2000 A/P (grand total)` — no discount variance | net cost (gross − discount) per unit |
| Purchase return of a discounted line | `Dr 2000 A/P / Cr 1300 Inventory (NET) + input-tax reversal` | net per-unit |

**Two new system accounts** (per-company data rows, auto-seeded for new companies, backfillable for existing via `defaults:ensure`; no schema migration):
- `4200 Inventory Adjustment Gain` — REVENUE, shown as other income (distinct from sales).
- `5300 Inventory Shrinkage & Loss` — EXPENSE, added to `NON_CATEGORY_EXPENSE_CODES` so it can't be picked as a manual expense category.

`5100 Inventory Valuation Adjustment` is **retained** — it no longer receives purchase discounts, and now absorbs only the documented Phase-5 return residue and sub-paise rounding.

All postings are balanced, use `Decimal` arithmetic (no floats), are **atomic with the stock movement** (same transaction), route through the single `createPostedEntryWithinTransaction` engine (so period guard, subscription gate and the debits==credits assertion all apply), and are **idempotent** via the `(companyId, sourceType, sourceId)` unique index (`sourceId` = the stock movement's id).

---

## 2. Before / after (representative scenarios)

| Scenario | Before | After |
|----------|--------|-------|
| Purchase 100 @ 100, 10% discount | `Dr 1300 10000`, `Cr 2000 9000`, `Cr 5100 1000` (discount booked as a gain in an expense account); WAC 100 | `Dr 1300 9000`, `Cr 2000 9000`; **WAC 90** |
| Sell 10 of that stock | COGS 1000 (gross) | **COGS 900** (net) |
| Discounted purchase, nothing sold → P&L | netProfit **+1000** (phantom) | netProfit **0** (saving sits in inventory until sold) |
| Opening stock 100 @ 10 (endpoint) | no GL entry; 1300 unchanged | `Dr 1300 1000 / Cr 3000 1000` |
| Damage 20 units @ WAC 10 | no GL entry; loss never reaches P&L | `Dr 5300 200 / Cr 1300 200` (expense recognised) |
| Found 10 units @ 12 | no GL entry | `Dr 1300 120 / Cr 4200 120` (other income) |
| Inventory vs 1300 after adjustments/opening stock | silently diverged | reconciles (now GL-backed); gap only from the deferred Phase-5 residue, which is **reported** |

---

## 3. Files changed

- `backend/src/modules/accounting/system-accounts.js` — accounts `4200`, `5300`; `5300` added to `NON_CATEGORY_EXPENSE_CODES`; `5100` description updated.
- `backend/src/modules/accounting/journal.service.js` — source types `INVENTORY_OPENING_STOCK`, `INVENTORY_ADJUSTMENT`.
- `backend/src/modules/accounting/gl-posting.service.js` — `recordOpeningStockPosted`, `recordStockAdjustmentPosted`.
- `backend/src/modules/accounting/accounting.validation.js` — the two new source types added to the read/filter allow-list.
- `backend/src/modules/inventory/inventory.service.js` — `applyMovement` gained an optional journal-posting callback; `createOpeningStock` and `createAdjustment` now post their GL entry atomically (the shared `applyMovementWithinTransaction` and the opening-balances module are untouched, so no double-posting).
- `backend/src/modules/inventory/inventory.repository.js` — `findBalancesForValuation` (for reconciliation).
- `backend/src/modules/purchases/purchase.service.js` — stock-in capitalised at net cost for discounted lines.
- `backend/src/modules/purchase-returns/purchase-return.service.js` — returns reverse stock at net per-unit.
- `backend/src/modules/periods/period-verification.service.js` — report-only `INVENTORY_RECONCILE` check (`blocking: false`); only blocking checks decide `ok`/`failed`.

**Migrations:** none new in this phase. The two new accounts are **data** rows; the schema is unchanged (the Phase-3A migrations are untouched). The full migration chain was already verified clean on a disposable database in Phase 3A; company creation in the test suite seeds the new accounts, and `resolveSystemAccounts` recreates any missing system account, so existing companies resolve them too (backfill via `defaults:ensure` — see the backfill plan).

---

## 4. Tests

**New:** `backend/tests/integration/inventory-accounting.test.js` (9) — opening-stock GL; opening-stock recorded once (409 on repeat, exactly one entry); exactly one entry under concurrent opening-stock attempts; positive adjustment → 4200; negative adjustment → 5300 at current WAC; discounted purchase → WAC 90 and a later sale's COGS = 900 (net); inventory valuation reconciles to the 1300 control account after mixed activity; `INVENTORY_RECONCILE` is report-only and never blocks; a stock adjustment dated in a **closed** period is refused (422) and posts no entry.

**Updated to the corrected policy** (they encoded the superseded gross/5100 behaviour): `accounting-documents.test.js` (discount now nets into inventory — `Dr 1300 9000`, no 5100 line; and a discounted purchase no longer creates phantom P&L profit) and `purchases.test.js` (discounted stock-in movement/average cost now 9.50, net of the 5% discount).

Existing coverage already exercises the brief's other required cases: full/partial **purchase returns** (`purchase-returns.test.js`, `purchase-return-discount.test.js`), **sales returns** (`sales-returns.test.js`), **GST + rounding** (`gst-documents.test.js`, `gst-returns.test.js`), **closed periods & unauthorized users** on the inventory endpoints (`inventory.test.js`, `opening-balances-periods.test.js`), and the **opening-balances module** reconciliation (`opening-balances-periods.test.js`) — all still pass, confirming no double-posting.

---

## 5. Results

- **Full backend suite (`npm test`):** 72 files / 1888 tests passed, exit 0 (238s) — up from 71/1879 before this phase (+1 file, +9 tests added here; 3 existing tests rewritten in place to the corrected policy; nothing regressed).
- **business-web typecheck:** PASS (exit 0). **business-web tests:** 19 files / 225 passed (exit 0).
- **Migrations / disposable DB:** no new migration this phase; the Phase-3A chain remains verified clean, and new-company seeding of `4200`/`5300` is exercised by the suite.
- Every posted journal entry balances (enforced by the posting engine), and the inventory sub-ledger reconciles to the 1300 control account within the documented tolerance (exact when no purchase return against a blended average has occurred).

---

## 6. Residual risks / explicitly not done

1. **Phase-5 return residue is NOT fixed** (deferred per the confirmed decision): a purchase return reverses stock at its original cost while remaining stock keeps the blended average, leaving a valuation gap that lands in `5100`. The `INVENTORY_RECONCILE` check **reports** it (never forces a balancing entry) and it does **not** block a period close. Eliminating it means reworking returns to reverse at the current average — a larger, separate change.
2. **Existing production data** needs a reviewed, non-executed backfill (new-account seeding; GL for pre-3B adjustments/opening stock; the gross→net WAC transition). See [PHASE_3B_BACKFILL_PLAN.md](PHASE_3B_BACKFILL_PLAN.md). Nothing was run against production.
3. **Adjustments and endpoint opening stock are now subscription-gated** (they post to the GL, so the posting gate applies). This is consistent with the system's rule that posting requires an active plan while reads stay open; it is a (correct) behaviour change worth noting to operators.
4. **Gain account presentation:** `4200` is REVENUE (other income). Confirm the P&L groups it separately from sales revenue in the frontend presentation layer if that distinction matters to the reader.
5. No browser or live-provider testing was performed or claimed.
