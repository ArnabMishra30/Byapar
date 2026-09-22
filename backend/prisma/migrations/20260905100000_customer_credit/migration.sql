-- Phase 14: customer/supplier credit terms and the credit-limit override audit.
--
-- ADDITIVE ONLY. Every column is nullable or carries a default, so existing rows
-- are valid the moment this runs and no existing data is read, moved or removed.
-- There is no DROP and no type change anywhere in this file.

-- Payment terms in days. NULL means "no terms recorded", which is what every
-- existing customer and supplier has today: due dates stay exactly as they are
-- unless someone sets a term.
ALTER TABLE "customers" ADD COLUMN "creditDays" INTEGER;
ALTER TABLE "suppliers" ADD COLUMN "creditDays" INTEGER;

-- Credit terms are days, not dates. A negative or absurd term is a data error,
-- so the database refuses it rather than letting it reach a due-date sum.
ALTER TABLE "customers"
  ADD CONSTRAINT "customers_creditDays_check" CHECK ("creditDays" IS NULL OR ("creditDays" >= 0 AND "creditDays" <= 3650));
ALTER TABLE "suppliers"
  ADD CONSTRAINT "suppliers_creditDays_check" CHECK ("creditDays" IS NULL OR ("creditDays" >= 0 AND "creditDays" <= 3650));

-- The credit-limit override: a record that an ADMIN chose to extend credit past
-- a limit. Not derivable from any other table, which is why it is stored.
ALTER TABLE "sales_invoices" ADD COLUMN "creditLimitOverride" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "sales_invoices" ADD COLUMN "creditLimitOverrideById" TEXT;
ALTER TABLE "sales_invoices" ADD COLUMN "creditLimitOverrideReason" TEXT;
ALTER TABLE "sales_invoices" ADD COLUMN "creditLimitOverrideExposure" DECIMAL(18,4);

ALTER TABLE "sales_invoices"
  ADD CONSTRAINT "sales_invoices_creditLimitOverrideById_fkey"
  FOREIGN KEY ("creditLimitOverrideById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- An override without the admin who made it would be an unattributable decision.
ALTER TABLE "sales_invoices"
  ADD CONSTRAINT "sales_invoices_creditOverride_attributed_check"
  CHECK ("creditLimitOverride" = false OR "creditLimitOverrideById" IS NOT NULL);

-- Overdue reporting reads receivables by due date per customer; the existing
-- index is (companyId, dueDate) only.
CREATE INDEX "customer_receivables_company_customer_due_idx"
  ON "customer_receivables" ("companyId", "customerId", "dueDate");
CREATE INDEX "supplier_payables_company_supplier_due_idx"
  ON "supplier_payables" ("companyId", "supplierId", "dueDate");
