-- CreateEnum
CREATE TYPE "SupplierPayableStatus" AS ENUM ('OPEN', 'PARTIALLY_PAID', 'PAID', 'CREDITED');

-- CreateEnum
CREATE TYPE "SupplierLedgerEntryType" AS ENUM ('PURCHASE', 'PURCHASE_RETURN', 'PAYMENT');

-- CreateEnum
CREATE TYPE "SupplierPaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'OTHER');

-- CreateEnum
CREATE TYPE "SupplierPaymentStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "supplier_payables" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "originalAmount" DECIMAL(18,4) NOT NULL,
    "creditAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "outstandingAmount" DECIMAL(18,4) NOT NULL,
    "dueDate" DATE,
    "status" "SupplierPayableStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_payables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_ledger_entries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "entryType" "SupplierLedgerEntryType" NOT NULL,
    "entryDate" DATE NOT NULL,
    "debit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "payableId" TEXT,
    "description" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "paymentNumber" TEXT NOT NULL,
    "paymentDate" DATE NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "allocatedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unallocatedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "paymentMethod" "SupplierPaymentMethod" NOT NULL,
    "referenceNumber" TEXT,
    "notes" TEXT,
    "status" "SupplierPaymentStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "postedById" TEXT,
    "postedAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payment_allocations" (
    "id" TEXT NOT NULL,
    "supplierPaymentId" TEXT NOT NULL,
    "supplierPayableId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payables_purchaseId_key" ON "supplier_payables"("purchaseId");

-- CreateIndex
CREATE INDEX "supplier_payables_companyId_supplierId_status_idx" ON "supplier_payables"("companyId", "supplierId", "status");

-- CreateIndex
CREATE INDEX "supplier_payables_companyId_dueDate_idx" ON "supplier_payables"("companyId", "dueDate");

-- CreateIndex
CREATE INDEX "supplier_ledger_entries_companyId_supplierId_entryDate_idx" ON "supplier_ledger_entries"("companyId", "supplierId", "entryDate");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_ledger_entries_companyId_referenceType_referenceId_key" ON "supplier_ledger_entries"("companyId", "referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "supplier_payments_companyId_supplierId_status_idx" ON "supplier_payments"("companyId", "supplierId", "status");

-- CreateIndex
CREATE INDEX "supplier_payments_companyId_paymentDate_idx" ON "supplier_payments"("companyId", "paymentDate");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payments_companyId_paymentNumber_key" ON "supplier_payments"("companyId", "paymentNumber");

-- CreateIndex
CREATE INDEX "supplier_payment_allocations_supplierPayableId_idx" ON "supplier_payment_allocations"("supplierPayableId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payment_allocations_supplierPaymentId_supplierPaya_key" ON "supplier_payment_allocations"("supplierPaymentId", "supplierPayableId");

-- AddForeignKey
ALTER TABLE "supplier_payables" ADD CONSTRAINT "supplier_payables_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payables" ADD CONSTRAINT "supplier_payables_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payables" ADD CONSTRAINT "supplier_payables_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_ledger_entries" ADD CONSTRAINT "supplier_ledger_entries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_ledger_entries" ADD CONSTRAINT "supplier_ledger_entries_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_ledger_entries" ADD CONSTRAINT "supplier_ledger_entries_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "supplier_payables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_ledger_entries" ADD CONSTRAINT "supplier_ledger_entries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_supplierPaymentId_fkey" FOREIGN KEY ("supplierPaymentId") REFERENCES "supplier_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_supplierPayableId_fkey" FOREIGN KEY ("supplierPayableId") REFERENCES "supplier_payables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

