-- Optional rack/shelf per purchase and sale line. Additive: two nullable columns.

-- AlterTable
ALTER TABLE "purchase_items" ADD COLUMN     "storageLocationId" TEXT;

-- AlterTable
ALTER TABLE "sales_invoice_items" ADD COLUMN     "storageLocationId" TEXT;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_storageLocationId_fkey" FOREIGN KEY ("storageLocationId") REFERENCES "storage_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_items" ADD CONSTRAINT "sales_invoice_items_storageLocationId_fkey" FOREIGN KEY ("storageLocationId") REFERENCES "storage_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

