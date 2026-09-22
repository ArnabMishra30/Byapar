-- CreateEnum
CREATE TYPE "SalesInvoiceStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CustomerReceivableStatus" AS ENUM ('OPEN', 'PARTIALLY_PAID', 'PAID', 'CREDITED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CustomerLedgerEntryType" AS ENUM ('SALE', 'PAYMENT', 'SALES_RETURN', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CustomerPaymentMethod" AS ENUM ('CASH', 'BANK', 'UPI', 'CHEQUE', 'OTHER');

-- CreateEnum
CREATE TYPE "CustomerPaymentStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "sales_invoices" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" DATE NOT NULL,
    "dueDate" DATE,
    "status" "SalesInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "cogsTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "customerNameSnapshot" TEXT NOT NULL,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "postedById" TEXT,
    "postedAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_invoice_items" (
    "id" TEXT NOT NULL,
    "salesInvoiceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "taxId" TEXT,
    "lineNumber" INTEGER NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "discountType" "DiscountType" NOT NULL DEFAULT 'NONE',
    "discountValue" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxableAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "cogsUnitCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "cogsAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "productNameSnapshot" TEXT NOT NULL,
    "skuSnapshot" TEXT,
    "unitNameSnapshot" TEXT NOT NULL,
    "taxNameSnapshot" TEXT,
    "taxRateSnapshot" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_receivables" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "salesInvoiceId" TEXT NOT NULL,
    "originalAmount" DECIMAL(18,4) NOT NULL,
    "paidAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "outstandingAmount" DECIMAL(18,4) NOT NULL,
    "dueDate" DATE,
    "status" "CustomerReceivableStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_receivables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_ledger_entries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "entryType" "CustomerLedgerEntryType" NOT NULL,
    "entryDate" DATE NOT NULL,
    "debit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "receivableId" TEXT,
    "description" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_payments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "paymentNumber" TEXT NOT NULL,
    "paymentDate" DATE NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "allocatedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unallocatedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "paymentMethod" "CustomerPaymentMethod" NOT NULL,
    "referenceNumber" TEXT,
    "notes" TEXT,
    "status" "CustomerPaymentStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "postedById" TEXT,
    "postedAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_payment_allocations" (
    "id" TEXT NOT NULL,
    "customerPaymentId" TEXT NOT NULL,
    "customerReceivableId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_invoices_companyId_status_idx" ON "sales_invoices"("companyId", "status");

-- CreateIndex
CREATE INDEX "sales_invoices_companyId_invoiceDate_idx" ON "sales_invoices"("companyId", "invoiceDate");

-- CreateIndex
CREATE INDEX "sales_invoices_companyId_customerId_idx" ON "sales_invoices"("companyId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoices_companyId_invoiceNumber_key" ON "sales_invoices"("companyId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "sales_invoice_items_salesInvoiceId_idx" ON "sales_invoice_items"("salesInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoice_items_salesInvoiceId_productId_key" ON "sales_invoice_items"("salesInvoiceId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_receivables_salesInvoiceId_key" ON "customer_receivables"("salesInvoiceId");

-- CreateIndex
CREATE INDEX "customer_receivables_companyId_customerId_status_idx" ON "customer_receivables"("companyId", "customerId", "status");

-- CreateIndex
CREATE INDEX "customer_receivables_companyId_dueDate_idx" ON "customer_receivables"("companyId", "dueDate");

-- CreateIndex
CREATE INDEX "customer_ledger_entries_companyId_customerId_entryDate_idx" ON "customer_ledger_entries"("companyId", "customerId", "entryDate");

-- CreateIndex
CREATE UNIQUE INDEX "customer_ledger_entries_companyId_referenceType_referenceId_key" ON "customer_ledger_entries"("companyId", "referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "customer_payments_companyId_customerId_status_idx" ON "customer_payments"("companyId", "customerId", "status");

-- CreateIndex
CREATE INDEX "customer_payments_companyId_paymentDate_idx" ON "customer_payments"("companyId", "paymentDate");

-- CreateIndex
CREATE UNIQUE INDEX "customer_payments_companyId_paymentNumber_key" ON "customer_payments"("companyId", "paymentNumber");

-- CreateIndex
CREATE INDEX "customer_payment_allocations_customerReceivableId_idx" ON "customer_payment_allocations"("customerReceivableId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_payment_allocations_customerPaymentId_customerRece_key" ON "customer_payment_allocations"("customerPaymentId", "customerReceivableId");

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_items" ADD CONSTRAINT "sales_invoice_items_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "sales_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_items" ADD CONSTRAINT "sales_invoice_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_items" ADD CONSTRAINT "sales_invoice_items_taxId_fkey" FOREIGN KEY ("taxId") REFERENCES "taxes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_receivables" ADD CONSTRAINT "customer_receivables_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_receivables" ADD CONSTRAINT "customer_receivables_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_receivables" ADD CONSTRAINT "customer_receivables_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_ledger_entries" ADD CONSTRAINT "customer_ledger_entries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_ledger_entries" ADD CONSTRAINT "customer_ledger_entries_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_ledger_entries" ADD CONSTRAINT "customer_ledger_entries_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "customer_receivables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_ledger_entries" ADD CONSTRAINT "customer_ledger_entries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payment_allocations" ADD CONSTRAINT "customer_payment_allocations_customerPaymentId_fkey" FOREIGN KEY ("customerPaymentId") REFERENCES "customer_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payment_allocations" ADD CONSTRAINT "customer_payment_allocations_customerReceivableId_fkey" FOREIGN KEY ("customerReceivableId") REFERENCES "customer_receivables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

