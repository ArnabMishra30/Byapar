-- MONEY ACCOUNTS: payments choose which cash/bank/wallet account; expenses may
-- be split across accounts. Additive only (new table, two nullable columns).

-- AlterTable
ALTER TABLE "supplier_payments" ADD COLUMN     "moneyAccountId" TEXT;

-- AlterTable
ALTER TABLE "customer_payments" ADD COLUMN     "moneyAccountId" TEXT;

-- CreateTable
CREATE TABLE "expense_payment_parts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "accountNameSnapshot" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "expense_payment_parts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expense_payment_parts_companyId_idx" ON "expense_payment_parts"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "expense_payment_parts_expenseId_accountId_key" ON "expense_payment_parts"("expenseId", "accountId");

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_moneyAccountId_fkey" FOREIGN KEY ("moneyAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_moneyAccountId_fkey" FOREIGN KEY ("moneyAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_payment_parts" ADD CONSTRAINT "expense_payment_parts_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_payment_parts" ADD CONSTRAINT "expense_payment_parts_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

