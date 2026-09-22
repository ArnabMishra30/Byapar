-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED', 'REVERSED');

-- CreateEnum
CREATE TYPE "ExpensePaymentMode" AS ENUM ('CASH', 'BANK');

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "expenseNumber" TEXT NOT NULL,
    "expenseDate" DATE NOT NULL,
    "expenseAccountId" TEXT NOT NULL,
    "categoryNameSnapshot" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(18,4) NOT NULL,
    "paymentMode" "ExpensePaymentMode" NOT NULL,
    "paymentAccountId" TEXT NOT NULL,
    "paymentAccountNameSnapshot" TEXT NOT NULL,
    "supplierId" TEXT,
    "supplierNameSnapshot" TEXT,
    "referenceNumber" TEXT,
    "notes" TEXT,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "postedById" TEXT,
    "postedAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "reversedById" TEXT,
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expenses_companyId_status_idx" ON "expenses"("companyId", "status");

-- CreateIndex
CREATE INDEX "expenses_companyId_expenseDate_idx" ON "expenses"("companyId", "expenseDate");

-- CreateIndex
CREATE INDEX "expenses_companyId_expenseAccountId_idx" ON "expenses"("companyId", "expenseAccountId");

-- CreateIndex
CREATE INDEX "expenses_companyId_supplierId_idx" ON "expenses"("companyId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_companyId_expenseNumber_key" ON "expenses"("companyId", "expenseNumber");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_expenseAccountId_fkey" FOREIGN KEY ("expenseAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_paymentAccountId_fkey" FOREIGN KEY ("paymentAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- An expense amount must be positive.
--
-- The service validates it too, but a CHECK constraint is what makes a zero or
-- negative expense impossible rather than merely unlikely: no code path, no
-- migration and no manual SQL can create one.
-- ---------------------------------------------------------------------------
ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_amount_positive_check" CHECK ("amount" > 0);

-- ---------------------------------------------------------------------------
-- SEED: the default expense categories, for every company that already exists.
--
-- A category IS an account, so these are ordinary system EXPENSE accounts. They
-- hang under 5200 Operating Expenses, which is a grouping account that nothing
-- posts to directly.
--
-- Insert-only, ON CONFLICT DO NOTHING - idempotent, and a no-op on a database
-- that already has them. No existing row is read, updated or deleted.
-- New companies get the same accounts from initializeCompanyDefaults().
-- ---------------------------------------------------------------------------
INSERT INTO "accounts" ("id", "companyId", "code", "name", "type", "isSystem", "isActive", "description", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(), c."id", a.code, a.name, 'EXPENSE'::"AccountType", true, true, a.description, NOW(), NOW()
FROM "companies" c
CROSS JOIN (
  VALUES
    ('5200', 'Operating Expenses', 'The parent of the day-to-day running costs below. A grouping account: expenses are filed under its children.'),
    ('5210', 'Rent', 'Shop, office or godown rent.'),
    ('5215', 'Electricity', 'Electricity bills.'),
    ('5220', 'Water', 'Water bills.'),
    ('5225', 'Internet & Telephone', 'Broadband, mobile and landline.'),
    ('5230', 'Salaries & Wages', 'Staff pay. Not a payroll system: one amount, one entry.'),
    ('5235', 'Transportation', 'Freight, delivery, fuel and travel.'),
    ('5240', 'Repairs & Maintenance', 'Upkeep of premises and equipment.'),
    ('5245', 'Office Expenses', 'Stationery, printing and sundry office costs.'),
    ('5250', 'Packaging', 'Bags, cartons and packing material.'),
    ('5255', 'Advertising & Marketing', 'Promotion of the business.'),
    ('5260', 'Bank Charges', 'Bank fees and transaction charges.'),
    ('5265', 'Professional Fees', 'Accountant, lawyer and consultant fees.'),
    ('5270', 'Insurance', 'Premiums on business insurance.'),
    ('5290', 'Miscellaneous Expenses', 'Anything that does not belong above.')
) AS a(code, name, description)
ON CONFLICT ("companyId", "code") DO NOTHING;

-- Hang each category under 5200, so a chart of accounts reads as a tree.
-- Idempotent: only rows with no parent are touched.
UPDATE "accounts" child
SET "parentId" = parent."id"
FROM "accounts" parent
WHERE child."companyId" = parent."companyId"
  AND child."parentId" IS NULL
  AND parent."code" = '5200'
  AND child."code" IN ('5210','5215','5220','5225','5230','5235','5240','5245','5250','5255','5260','5265','5270','5290');
