# Phase 3B — Inventory Accounting Backfill Plan (REVIEW ONLY — do not execute on production)

**Status:** PLAN. Nothing in here has been run against any database. It must be reviewed and run first on a disposable/staging database, with a Neon branch snapshot taken beforehand, and only then — with explicit sign-off — against production.

## Why a backfill is needed

The Phase 3B posting changes apply to **new** postings only (posted documents are immutable). Existing companies therefore carry three transitional artifacts:

1. **Pre-3B opening stock (inventory endpoint) and stock adjustments posted NO journal entry.** The Inventory control account (1300) is understated (losses/opening) or mis-stated versus the physical stock ledger for those movements.
2. **Pre-3B purchases capitalised inventory at GROSS cost** with the discount parked in `5100`. On-hand stock is a mix of gross-costed (old) and net-costed (new) layers until it turns over.
3. **The new accounts `4200` / `5300` are not yet present** on companies created before 3B.

## Step 1 — Seed the new accounts (safe, idempotent)

```
npm run defaults:ensure            # staging / local
npm run defaults:ensure:prod       # production, only after sign-off
```

`ensureDefaults()` loops every company and calls the idempotent `createMany({ skipDuplicates: true })`, so it inserts only the missing `4200` (Inventory Adjustment Gain) and `5300` (Inventory Shrinkage & Loss) rows. It changes nothing else, cannot duplicate, and system-account code/type are immutable. This step is low-risk and is the prerequisite for Steps 2–3.

## Step 2 — Backfill GL for historical adjustments / opening stock (reviewed)

For each pre-3B `StockMovement` whose `referenceType` is `OPENING_STOCK` (entered via the inventory endpoint, **not** the opening-balances module) or `STOCK_ADJUSTMENT`, and which has **no** journal entry, post one dated correcting entry using the Phase 3B rules:

- `OPENING_STOCK` → `Dr 1300 / Cr 3000` at `movement.totalCost`.
- `ADJUSTMENT_IN`  → `Dr 1300 / Cr 4200` at `movement.totalCost`.
- `ADJUSTMENT_OUT` → `Dr 5300 / Cr 1300` at `movement.totalCost`.

Design of the backfill script (to be written and reviewed; not included here as runnable code):
- **Idempotent** via the existing `(companyId, sourceType, sourceId)` unique — `sourceType = INVENTORY_OPENING_STOCK | INVENTORY_ADJUSTMENT`, `sourceId = movement.id`. Re-running skips anything already posted.
- **Dry-run first:** report, per company, the movement count and the net GL impact on 1300 / 4200 / 5300, with **no writes**. A human reviews the totals before any posting.
- Entries dated into an **open** period only (never a closed one); if the movement's period is closed, list it for manual handling rather than forcing a posting into a locked period.
- Exclude opening-balances-module movements (those already have a GL entry).
- Skip zero-value movements (they post nothing, by design).

## Step 3 — Discount-netting / WAC restatement (recommended: DO NOT restate)

Restating on-hand moving-average cost from gross to net would change reported COGS and gross profit for **closed** periods, which is almost never desirable. **Recommendation: do not restate.** Let the gross-costed layers wash out as stock turns over; new purchases are net from 3B onward. The `INVENTORY_RECONCILE` check will show the transitional gap explicitly rather than hiding it. Restatement should only be considered with accountant sign-off and a full before/after of each affected period.

## Step 4 — Verification (staging)

After Steps 1–2 on staging:
- `INVENTORY_RECONCILE` (period verify / reconciliation report) should read ~zero for companies with **no** purchase returns against a blended average; companies with such returns retain the documented Phase-5 residue (reported, not forced).
- Trial balance and balance sheet still balance (the backfill posts only balanced entries).
- Spot-check a sample of backfilled companies' inventory valuation vs the 1300 balance.

## Safety rules

- Additive and idempotent only; no `UPDATE`/`DELETE` of existing journal lines or movements.
- Dry-run → review → staging → (sign-off) → production, with a Neon branch snapshot before production.
- Never run `prisma migrate reset`, `db push`, or the demo seeds against production.
