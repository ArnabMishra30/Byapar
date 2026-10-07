-- COMBOS: a product sold as one item whose contents leave stock individually.
-- Additive only. Also records each sale line's list price, so price changes are traceable.

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "isAdHoc" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isCombo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "sales_invoice_items" ADD COLUMN     "listPriceSnapshot" DECIMAL(18,4);

-- CreateTable
CREATE TABLE "combo_components" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "comboProductId" TEXT NOT NULL,
    "componentProductId" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,

    CONSTRAINT "combo_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_invoice_item_components" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "salesInvoiceItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productNameSnapshot" TEXT NOT NULL,
    "quantityPerUnit" DECIMAL(18,6) NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "cogsUnitCost" DECIMAL(18,4) NOT NULL,
    "cogsAmount" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "sales_invoice_item_components_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "combo_components_companyId_idx" ON "combo_components"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "combo_components_comboProductId_componentProductId_key" ON "combo_components"("comboProductId", "componentProductId");

-- CreateIndex
CREATE INDEX "sales_invoice_item_components_companyId_idx" ON "sales_invoice_item_components"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoice_item_components_salesInvoiceItemId_productId_key" ON "sales_invoice_item_components"("salesInvoiceItemId", "productId");

-- AddForeignKey
ALTER TABLE "combo_components" ADD CONSTRAINT "combo_components_comboProductId_fkey" FOREIGN KEY ("comboProductId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combo_components" ADD CONSTRAINT "combo_components_componentProductId_fkey" FOREIGN KEY ("componentProductId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_item_components" ADD CONSTRAINT "sales_invoice_item_components_salesInvoiceItemId_fkey" FOREIGN KEY ("salesInvoiceItemId") REFERENCES "sales_invoice_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_item_components" ADD CONSTRAINT "sales_invoice_item_components_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

