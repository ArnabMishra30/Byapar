-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "JournalEntryStatus" AS ENUM ('DRAFT', 'POSTED');

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "parentId" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "journalNumber" TEXT NOT NULL,
    "entryDate" DATE NOT NULL,
    "description" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "status" "JournalEntryStatus" NOT NULL DEFAULT 'POSTED',
    "totalDebit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalCredit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reversalOfId" TEXT,
    "createdById" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "description" TEXT,
    "debit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "entryDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accounts_companyId_type_idx" ON "accounts"("companyId", "type");

-- CreateIndex
CREATE INDEX "accounts_companyId_parentId_idx" ON "accounts"("companyId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_companyId_code_key" ON "accounts"("companyId", "code");

-- CreateIndex
CREATE INDEX "journal_entries_companyId_entryDate_idx" ON "journal_entries"("companyId", "entryDate");

-- CreateIndex
CREATE INDEX "journal_entries_companyId_status_idx" ON "journal_entries"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_companyId_journalNumber_key" ON "journal_entries"("companyId", "journalNumber");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_companyId_sourceType_sourceId_key" ON "journal_entries"("companyId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "journal_lines_journalEntryId_idx" ON "journal_lines"("journalEntryId");

-- CreateIndex
CREATE INDEX "journal_lines_companyId_accountId_entryDate_idx" ON "journal_lines"("companyId", "accountId", "entryDate");

-- CreateIndex
CREATE INDEX "journal_lines_companyId_entryDate_idx" ON "journal_lines"("companyId", "entryDate");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- DOUBLE-ENTRY INVARIANTS, ENFORCED BY THE DATABASE
--
-- The service validates these too, but a CHECK constraint is what makes a
-- malformed journal line impossible rather than merely unlikely: no code path,
-- no migration and no manual SQL can create one.
--   * neither side may be negative
--   * exactly one side must be non-zero (never both, never neither)
-- ---------------------------------------------------------------------------
ALTER TABLE "journal_lines"
  ADD CONSTRAINT "journal_lines_single_side_check"
  CHECK (
    "debit" >= 0
    AND "credit" >= 0
    AND (("debit" > 0 AND "credit" = 0) OR ("credit" > 0 AND "debit" = 0))
  );

ALTER TABLE "journal_entries"
  ADD CONSTRAINT "journal_entries_totals_non_negative_check"
  CHECK ("totalDebit" >= 0 AND "totalCredit" >= 0);

-- ---------------------------------------------------------------------------
-- SEED: the system chart of accounts for every company that already exists.
--
-- Insert-only. ON CONFLICT DO NOTHING makes it idempotent and makes re-running
-- the migration on a database that already has accounts a no-op. No existing row
-- is read, updated or deleted by this statement.
--
-- New companies get the same accounts from initializeCompanyDefaults(), which
-- uses the same codes.
-- ---------------------------------------------------------------------------
INSERT INTO "accounts" ("id", "companyId", "code", "name", "type", "isSystem", "isActive", "description", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  c."id",
  a.code,
  a.name,
  a.type::"AccountType",
  true,
  true,
  a.description,
  NOW(),
  NOW()
FROM "companies" c
CROSS JOIN (
  VALUES
    ('1000', 'Cash', 'ASSET', 'Physical cash. Debited by cash receipts, credited by cash payments.'),
    ('1010', 'Bank', 'ASSET', 'Bank account. Used by every non-cash payment method.'),
    ('1200', 'Accounts Receivable', 'ASSET', 'Control account for what customers owe. Mirrors the customer sub-ledger.'),
    ('1300', 'Inventory', 'ASSET', 'Control account for stock on hand. Mirrors the inventory ledger.'),
    ('1400', 'Advance to Suppliers', 'ASSET', 'Money paid to a supplier that is not yet allocated to a bill.'),
    ('1500', 'Input Tax Credit', 'ASSET', 'Tax paid on purchases and recoverable. Not a GST return - see the limitations.'),
    ('2000', 'Accounts Payable', 'LIABILITY', 'Control account for what we owe suppliers. Mirrors the supplier sub-ledger.'),
    ('2100', 'Tax Payable', 'LIABILITY', 'Tax charged on sales and owed to the authority.'),
    ('2200', 'Customer Advances', 'LIABILITY', 'Money received from a customer that is not yet allocated to an invoice.'),
    ('3000', 'Owner''s Capital', 'EQUITY', 'Owner funds. No document flow posts here yet; it exists for opening balances.'),
    ('4000', 'Sales Revenue', 'REVENUE', 'Revenue from sales, net of discount and excluding tax.'),
    ('4100', 'Sales Returns', 'REVENUE', 'Contra-revenue. Carries a DEBIT balance and is subtracted from revenue.'),
    ('5000', 'Cost of Goods Sold', 'EXPENSE', 'What sold stock cost us, at the COGS frozen on the invoice line.'),
    ('5100', 'Inventory Valuation Adjustment', 'EXPENSE', 'Purchase price variance: the gap between what stock was capitalised at and what was actually owed (purchase discounts, and the Phase 5 return-at-original-cost residue).')
) AS a(code, name, type, description)
ON CONFLICT ("companyId", "code") DO NOTHING;
