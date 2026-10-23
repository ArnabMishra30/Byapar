# Phase 3B — Inventory Accounting Design (policy proposal, pre-implementation)

**Date:** 2026-10-14
**Status:** DESIGN — awaiting validation. **No posting logic has been changed.** Per the brief, implementation (Phase C) happens only after this policy is validated.
**Inputs read:** [QA_AUDIT_REPORT.md](../../QA_AUDIT_REPORT.md) (the brief's `SHOP_WEB_E2E_AUDIT.md` does not exist — this is the audit), Phase 1/2/3A reports, `backend/docs/architecture.md`, and the live code/chart-of-accounts/tests.

---

## 1. Verified current state (not assumed)

Account types were read from `system-accounts.js` directly — none are assumed.

| Account | Code | **Type (verified)** | Role today |
|---|---|---|---|
| Inventory | 1300 | **ASSET** | Control account; `Dr` on stock in, `Cr` on COGS/returns |
| Owner's Capital | 3000 | **EQUITY** | Opening-balances counterpart; "exists for opening balances" |
| Sales Revenue / Sales Returns | 4000 / 4100 | **REVENUE** (4100 contra) | Sales side |
| Cost of Goods Sold | 5000 | **EXPENSE** | COGS at frozen cost |
| Inventory Valuation Adjustment | 5100 | **EXPENSE** | Purchase-discount variance **and** the Phase-5 return residue |
| Operating Expenses (+children) | 5200+ | **EXPENSE** | Expense categories |

**There is no dedicated inventory-loss/shrinkage account and no inventory-gain/other-income account.** The only revenue accounts are sales (4000/4100).

**Behaviour today (file-cited):**
- **Opening stock — two paths.** (i) The **inventory endpoint** `createOpeningStock` (`inventory.service.js:353-371`) writes a `StockMovement` + `InventoryBalance` and **posts no journal entry**. (ii) The **opening-balances module** `initialize` (`opening-balance.service.js:494-564`) creates `OPENING_STOCK` movements **and** posts a balanced JE (`Dr 1300 / Cr 3000`). Both guard `requireNoExistingBalance`, so a given product+warehouse gets opening stock from exactly one path.
- **Stock adjustments** (`inventory.service.js:373-395`) write a movement (loss valued at current WAC, gain at the supplied cost) and **post no journal entry**. Losses never reach the P&L; the Inventory asset silently drifts from the 1300 control account.
- **Purchase discounts** capitalise inventory at **gross** (`purchase.service.js:447` passes gross `item.unitCost` into stock-in), and `buildPurchaseLines` plugs the discount as a **credit to 5100** (`gl-posting.service.js:75-141`). Because 5100 is an **expense** account, a discount is booked as an immediate gain in an expense account, and WAC/COGS carry the gross (over-stated) cost until the stock is sold.
- **Moving-average & COGS** are correct and single-sourced: WAC on IN, cost frozen on OUT, COGS = `sumMovementCost` of the stock-out movements (`gl-posting.service.js:293-353`).
- **Reconciliation** compares `Σ(qty × averageCost)` (reports) with the 1300 GL balance. It matches **by construction** only when stock arrives via a GL-backed flow with uniform cost; it **diverges** by the documented Phase-5 residue after a purchase return against a blended average (`accounting-documents.test.js:1042-1071`, measured at 250), and **silently** after any stock adjustment or inventory-endpoint opening stock (no GL posted). The **period-close guard checks AR and AP but not inventory** (`period-verification.service.js:53-148`).

---

## 2. Proposed policy

### 2.1 Opening stock (inventory endpoint)
`createOpeningStock` will post, **atomically with the movement**, in the endpoint's own transaction:

```
Dr  Inventory (1300)            quantity × unitCost   (= movement.totalCost)
    Cr Owner's Capital (3000)   same
```

- Posted **only** from the endpoint path. The opening-balances module keeps its own JE. **Double-posting is prevented by construction**: the per-product `requireNoExistingBalance` guard means a product's opening value reaches 1300 through exactly one path, and the JE is added in the endpoint service function — **not** in the shared `applyMovementWithinTransaction` that the module also calls. (Auto-posting inside that shared function would double-count the module's inventory and break `opening-balances-periods.test.js`.)
- Idempotency: `sourceType = INVENTORY_OPENING_STOCK`, `sourceId = movement.id`; the existing `(companyId, sourceType, sourceId)` unique index applies. The balance guard already prevents a second opening-stock per product+warehouse.

### 2.2 Stock adjustments
`createAdjustment` will post, atomically with the movement:

- **Decrease** (`ADJUSTMENT_OUT`; damage, loss, shrinkage), valued at the current WAC (the movement's `totalCost`):
  ```
  Dr  Inventory Shrinkage & Loss (NEW, EXPENSE)   loss value
      Cr Inventory (1300)                          loss value
  ```
- **Increase** (`ADJUSTMENT_IN`; found stock / count surplus), valued at the supplied unit cost:
  ```
  Dr  Inventory (1300)                 gain value
      Cr Inventory Adjustment Gain (NEW)   gain value
  ```
- Reasons stay auditable: the movement keeps its `notes`/`type`; the JE description carries the reason; the immutable `StockMovement` ledger and reversal-based corrections are unchanged (no movement is ever edited or deleted).
- Idempotency: `sourceType = INVENTORY_ADJUSTMENT`, `sourceId = movement.id` (unique per adjustment).

**Decision needed — the two new accounts** (proposed; confirm codes/types/presentation):
| Proposed | Code | Type | Note |
|---|---|---|---|
| Inventory Shrinkage & Loss | `5300` | EXPENSE | losses/write-downs; added to `NON_CATEGORY_EXPENSE_CODES` so it can't be picked as an expense category |
| Inventory Adjustment Gain | `4200` | REVENUE | found stock / write-ups |

- Alternative considered: net both through one "Inventory Adjustments" expense account. Rejected because an expense account carrying a credit balance is the exact anti-pattern we are removing from 5100. The brief also asks for a distinct loss account and a distinct gain account.
- **Presentation caveat to confirm:** a REVENUE-typed gain account will appear under revenue on the P&L. If it should read as *other income* distinct from sales (recommended), the P&L grouping in `report.service.js` must present 4200 separately — verify before implementing, or make the gain a contra to 5300 instead. This is a chart-of-accounts/presentation decision for whoever owns the books.

### 2.3 Purchase discounts → capitalise NET
- Stock in at the **net** per-unit cost = `taxableAmount / quantity` (taxable = gross − discount, already stored on `PurchaseItem`). WAC and the frozen COGS then reflect the price actually paid.
- `buildPurchaseLines` then needs no discount variance: `Dr Inventory(net) + Dr Input tax / Cr A/P(grandTotal)` balances exactly (net + tax = grandTotal), so **no 5100 posting for discounts**. GST is unchanged (computed on taxable, as today).
- **Purchase returns must mirror it:** the return's stock-out `outUnitCostOverride` changes from gross `unitCost` to the **net** per-unit cost (`taxableAmount / quantity`), so the inventory credit on a return matches what was capitalised. (This composes with the Phase-1 H1 fix, which already made the return's taxable net.)
- **5100 is retained** — it still absorbs the Phase-5 return-at-original-cost residue (§2.4), and `NON_CATEGORY_EXPENSE_CODES` still lists it (`expense-posting.test.js:182`). We only stop routing *discounts* through it.

### 2.4 Reconciliation (report + close), without forcing balances
- Keep valuation = `Σ round(qty × averageCost, 4)` and compare to the 1300 GL balance.
- After §2.1–2.3, adjustments and endpoint opening stock become GL-backed and discounts are net, so reconciliation becomes exact **except** for the **documented Phase-5 residue** (purchase return removes at original cost while remaining stock keeps the blended average) and sub-paise rounding.
- Add an **`INVENTORY_RECONCILE` check** that computes `valuation − 1300` and reports it, attributing any difference to the known residue within an **explicit tolerance** (rounding: a few paise; plus the measurable return residue). It **never posts a balancing entry** to force a match.
- **Decision needed:** should `INVENTORY_RECONCILE` **block** a period close or only **warn/report**? Recommendation: **report** (surface it in `verifyPeriod`'s results and the reconciliation report) but do **not** block, because the Phase-5 residue is by-design; blocking would wedge every close until returns-costing is reworked (out of scope here). Blocking can be switched on later once the residue is eliminated.

---

## 3. Implementation plan (Phase C, on approval) — smallest safe changes

1. **New accounts** — add `5300`/`4200` to `SYSTEM_ACCOUNTS` (and 5300 to `NON_CATEGORY_EXPENSE_CODES`). Auto-seeds for new companies; backfilled for existing via `npm run defaults:ensure` (idempotent `createMany skipDuplicates`; code/type immutable, add-only). **No schema migration.**
2. **GL builders** — add `recordOpeningStockPosted` and `recordStockAdjustmentPosted` to `gl-posting.service.js` (balanced lines, routed through `createPostedEntryWithinTransaction` like every other posting — so period guard, subscription gate, and balance assertion all apply). In `buildPurchaseLines`, the discount variance disappears naturally once `inventoryValue` arrives net; keep the `varianceLine` only for the return residue.
3. **Inventory service** — `createOpeningStock` and `createAdjustment` open their own `withRetryableTransaction`, call `applyMovementWithinTransaction(tx, …)`, then post the JE in the **same tx** (atomic stock+GL). The shared movement function and the opening-balances module are untouched (no double-post).
4. **Purchase posting/returns** — pass net per-unit cost into `applyStockIn` (`purchase.service.js`) and net `outUnitCostOverride` into the return's `applyStockOut` (`purchase-return.service.js`).
5. **Reconciliation check** — add `INVENTORY_RECONCILE` to `period-verification.service.js` (report-only) and/or the reconciliation report; document the tolerance.
6. **Money** — all amounts via the existing `Decimal` helpers; no floats. Postings are balanced and atomic with the stock movement; idempotent via `(companyId, sourceType, sourceId)`.
7. **Preserve** — tenant isolation, period locks, subscription gate, permissions, immutable posted documents; cancellation/reversal still reverse stock and GL exactly once.

**Test ripple to fix (determinate):**
- `accounting-journal.test.js:181-194` & `:196-206` — discount-variance unit tests → rewrite to net (no 5100 line).
- `accounting-documents.test.js:315-336` ("posts a purchase discount to 5100") → 1300 Dr 9000, A/P 9000, no 5100; `:830-848` (P&L shows −1000 other-expense) → 0.
- `purchases.test.js:563-582` — discounted stock-in movement cost `10.0000` → `9.5000` (avg too).
- New regression tests per the brief (opening stock, ±adjustments, loss, discounted purchase + WAC + later COGS, returns, cancellation/reversal, concurrency, reconciliation, GST/rounding, closed period, unauthorized).

---

## 4. Existing-data / backfill (plan only — not to be executed here)

Posted documents are immutable, so the policy applies to **new** postings; it does not retroactively re-post history. Consequences for existing companies:
- **Adjustments/opening stock already recorded without a JE** leave the 1300 control account understated/overstated versus the stock ledger. A reviewed backfill would post one dated correcting JE per past adjustment/endpoint-opening-stock movement (Dr/Cr per §2.1–2.2), or a single as-at opening correction, into an **open** period.
- **Discount-netting** changes WAC only going forward, so stock on hand becomes a mix of gross-costed (old) and net-costed (new) layers until it turns over — a known transitional artifact, not an error. A backfill could restate on-hand WAC to net, but this changes reported COGS/GP for closed periods and should not be done lightly.
- **A separate, reviewed `docs/qa/PHASE_3B_BACKFILL_PLAN.md` will be written before any backfill.** Nothing is run against production. The `INVENTORY_RECONCILE` check surfaces the pre-backfill gap explicitly rather than hiding it.

---

## 5. Risks & open decisions (need validation before Phase C)

1. **New accounts `5300`/`4200`** — confirm codes, names, types, and the P&L presentation of the gain account (other-income vs contra-expense). *(§2.2)*
2. **Discount-netting is a real behaviour change** to WAC/COGS and the purchase/return GL shape, with a known test ripple and a mixed-basis transition for on-hand stock. Confirm we net (per the brief) rather than keep the current gross+5100 treatment. *(§2.3, §4)*
3. **`INVENTORY_RECONCILE`: report vs block** at period close. Recommendation: report. *(§2.4)*
4. **Phase-5 return residue is intentionally NOT fixed here** (it needs returns to reverse at current average — a separate, larger change). The reconciliation check will report it within tolerance. Confirm that is acceptable for this phase. *(§2.4)*
5. **No account-model blocker found** — the policy is implementable with two additive accounts and the existing posting engine.

---

## 6. Recommendation

Approve §2.1 (opening-stock GL), §2.2 (adjustment GL with the two new accounts), §2.3 (net discounts), and §2.4 (report-only reconciliation check), with the four decisions in §5 confirmed. On approval I will implement the smallest safe changes in §3 with full regression tests, run the complete backend suite + business-web checks, verify migrations/seeding on a disposable DB, compare before/after accounting scenarios, and deliver `PHASE_3B_INVENTORY_ACCOUNTING_REPORT.md` — and a separate, non-executed backfill plan.
