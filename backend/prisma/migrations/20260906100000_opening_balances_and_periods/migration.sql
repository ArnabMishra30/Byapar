-- Phase 15: opening balances and accounting periods.
--
-- ADDITIVE AND RELAXING ONLY. There is no DROP TABLE, no DROP COLUMN, no data
-- deletion and no narrowing of any existing constraint. The two ALTER COLUMN
-- statements RELAX a NOT NULL, which every existing row already satisfies, so
-- the migration is safe on live data and cannot invalidate a single record.

-- A receivable may now exist without an invoice behind it, and a payable without
-- a purchase: that is what an OPENING BALANCE is. Inventing a fake invoice to
-- carry one would put a sale in the books that never happened.
--
-- The UNIQUE indexes are deliberately left in place. Postgres allows any number
-- of NULLs under a unique index, so "one invoice raises at most one receivable"
-- still holds exactly as before, while opening rows sit outside it.
ALTER TABLE "customer_receivables" ALTER COLUMN "salesInvoiceId" DROP NOT NULL;
ALTER TABLE "supplier_payables" ALTER COLUMN "purchaseId" DROP NOT NULL;

-- Both sub-ledgers gain an opening-balance entry type.
ALTER TYPE "CustomerLedgerEntryType" ADD VALUE IF NOT EXISTS 'OPENING_BALANCE';
ALTER TYPE "SupplierLedgerEntryType" ADD VALUE IF NOT EXISTS 'OPENING_BALANCE';

-- The strict-period opt-in. FALSE is exactly how every company behaved before
-- periods existed, so no existing company changes behaviour.
ALTER TABLE "company_settings"
  ADD COLUMN "requireOpenPeriod" BOOLEAN NOT NULL DEFAULT false;

-- Accounting periods.
CREATE TYPE "AccountingPeriodStatus" AS ENUM ('OPEN', 'CLOSED');

CREATE TABLE "accounting_periods" (
    "id"           TEXT NOT NULL,
    "companyId"    TEXT NOT NULL,
    "name"         TEXT NOT NULL,
    "startDate"    DATE NOT NULL,
    "endDate"      DATE NOT NULL,
    "status"       "AccountingPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "createdById"  TEXT NOT NULL,
    "closedById"   TEXT,
    "closedAt"     TIMESTAMP(3),
    "reopenedById" TEXT,
    "reopenedAt"   TIMESTAMP(3),
    "reopenReason" TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_periods_pkey" PRIMARY KEY ("id")
);

-- A period that ends before it starts is a data error, not a business case.
ALTER TABLE "accounting_periods"
  ADD CONSTRAINT "accounting_periods_range_check" CHECK ("startDate" <= "endDate");

-- A closed period must say who closed it. An unattributable close is not a close.
ALTER TABLE "accounting_periods"
  ADD CONSTRAINT "accounting_periods_closed_attributed_check"
  CHECK ("status" <> 'CLOSED' OR "closedById" IS NOT NULL);

CREATE UNIQUE INDEX "accounting_periods_companyId_name_key"
  ON "accounting_periods" ("companyId", "name");
CREATE INDEX "accounting_periods_companyId_startDate_endDate_idx"
  ON "accounting_periods" ("companyId", "startDate", "endDate");
CREATE INDEX "accounting_periods_companyId_status_idx"
  ON "accounting_periods" ("companyId", "status");

ALTER TABLE "accounting_periods"
  ADD CONSTRAINT "accounting_periods_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounting_periods"
  ADD CONSTRAINT "accounting_periods_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounting_periods"
  ADD CONSTRAINT "accounting_periods_closedById_fkey"
  FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounting_periods"
  ADD CONSTRAINT "accounting_periods_reopenedById_fkey"
  FOREIGN KEY ("reopenedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
