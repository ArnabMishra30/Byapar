-- OFFERS (buy X get Y free) and free sale lines. Additive, except that the
-- one-line-per-product unique index on sales_invoice_items is widened to
-- (invoice, product, isFree); every existing row stays valid (isFree=false).

-- DropIndex
DROP INDEX "sales_invoice_items_salesInvoiceId_productId_key";

-- AlterTable
ALTER TABLE "sales_invoice_items" ADD COLUMN     "isFree" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "offerId" TEXT;

-- CreateTable
CREATE TABLE "offers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "buyProductId" TEXT NOT NULL,
    "buyQuantity" DECIMAL(18,6) NOT NULL,
    "freeProductId" TEXT NOT NULL,
    "freeQuantity" DECIMAL(18,6) NOT NULL,
    "startDate" DATE,
    "endDate" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "offers_companyId_buyProductId_idx" ON "offers"("companyId", "buyProductId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoice_items_salesInvoiceId_productId_isFree_key" ON "sales_invoice_items"("salesInvoiceId", "productId", "isFree");

-- AddForeignKey
ALTER TABLE "sales_invoice_items" ADD CONSTRAINT "sales_invoice_items_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_buyProductId_fkey" FOREIGN KEY ("buyProductId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_freeProductId_fkey" FOREIGN KEY ("freeProductId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

