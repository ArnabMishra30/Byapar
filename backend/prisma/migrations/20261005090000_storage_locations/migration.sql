-- STORAGE LOCATIONS: racks, shelves, drawers, fridges inside a warehouse.
-- Additive only: a new table and enum, and two nullable columns. Existing
-- products and stock movements simply have no location until one is set.

-- CreateEnum
CREATE TYPE "StorageLocationType" AS ENUM ('RACK', 'SHELF', 'DRAWER', 'FRIDGE', 'FREEZER', 'COUNTER', 'BIN', 'BOX', 'OTHER');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "storageLocationId" TEXT;

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "storageLocationId" TEXT;

-- CreateTable
CREATE TABLE "storage_locations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "StorageLocationType" NOT NULL DEFAULT 'RACK',
    "code" TEXT,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storage_locations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "storage_locations_companyId_warehouseId_idx" ON "storage_locations"("companyId", "warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "storage_locations_companyId_warehouseId_name_key" ON "storage_locations"("companyId", "warehouseId", "name");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_storageLocationId_fkey" FOREIGN KEY ("storageLocationId") REFERENCES "storage_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_locations" ADD CONSTRAINT "storage_locations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_locations" ADD CONSTRAINT "storage_locations_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_storageLocationId_fkey" FOREIGN KEY ("storageLocationId") REFERENCES "storage_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

