-- PARTY MASTER. Additive only: a new table, two nullable columns, and a backfill.
-- Nothing is dropped, renamed or rewritten. Posted documents, ledgers and journal
-- entries still point at the same customer and supplier ids they always did.

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "partyId" TEXT;

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "partyId" TEXT;

-- CreateTable
CREATE TABLE "parties" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactPerson" TEXT,
    "phone" TEXT,
    "alternatePhone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "stateCode" TEXT,
    "pincode" TEXT,
    "country" TEXT,
    "gstin" TEXT,
    "pan" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parties_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "parties_companyId_idx" ON "parties"("companyId");

-- CreateIndex
CREATE INDEX "parties_companyId_phone_idx" ON "parties"("companyId", "phone");

-- CreateIndex
CREATE INDEX "parties_companyId_gstin_idx" ON "parties"("companyId", "gstin");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_partyId_key" ON "suppliers"("partyId");

-- CreateIndex
CREATE UNIQUE INDEX "customers_partyId_key" ON "customers"("partyId");

-- AddForeignKey
ALTER TABLE "parties" ADD CONSTRAINT "parties_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- BACKFILL: one party per existing customer, and one per existing supplier.
--
-- NO AUTOMATIC MERGING. A customer and a supplier that look alike (same name,
-- same phone) may still be two different businesses, and guessing wrong would
-- mix two people's contact details. The shop links them explicitly from the
-- party screen (POST /parties/:id/link) when it knows they are the same.
--
-- The party reuses the customer's (or supplier's) own id, so the backfill is
-- deterministic and safe to run twice: rows that already have a party are left
-- alone, and ON CONFLICT skips a party that already exists.
INSERT INTO "parties" ("id", "companyId", "name", "phone", "email", "address", "stateCode", "gstin", "isActive", "createdAt", "updatedAt")
SELECT c."id", c."companyId", c."name", c."phone", c."email", c."address", c."stateCode", c."gstin", c."isActive", c."createdAt", CURRENT_TIMESTAMP
FROM "customers" c
WHERE c."partyId" IS NULL
ON CONFLICT ("id") DO NOTHING;

UPDATE "customers" c
SET "partyId" = c."id"
WHERE c."partyId" IS NULL
  AND EXISTS (SELECT 1 FROM "parties" p WHERE p."id" = c."id" AND p."companyId" = c."companyId");

INSERT INTO "parties" ("id", "companyId", "name", "phone", "email", "address", "stateCode", "gstin", "isActive", "createdAt", "updatedAt")
SELECT s."id", s."companyId", s."name", s."phone", s."email", s."address", s."stateCode", s."gstin", s."isActive", s."createdAt", CURRENT_TIMESTAMP
FROM "suppliers" s
WHERE s."partyId" IS NULL
ON CONFLICT ("id") DO NOTHING;

UPDATE "suppliers" s
SET "partyId" = s."id"
WHERE s."partyId" IS NULL
  AND EXISTS (SELECT 1 FROM "parties" p WHERE p."id" = s."id" AND p."companyId" = s."companyId")
  AND NOT EXISTS (SELECT 1 FROM "customers" c WHERE c."partyId" = s."id");
