-- CreateEnum
CREATE TYPE "GstRegistrationType" AS ENUM ('REGULAR', 'COMPOSITION', 'UNREGISTERED', 'SEZ', 'OTHER');

-- CreateEnum
CREATE TYPE "SupplyType" AS ENUM ('INTRA_STATE', 'INTER_STATE');

-- CreateEnum
CREATE TYPE "TaxTreatment" AS ENUM ('TAXABLE', 'EXEMPT', 'NIL_RATED', 'ZERO_RATED');

-- CreateEnum
CREATE TYPE "TaxClassificationKind" AS ENUM ('HSN', 'SAC');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "gstRegistrationType" "GstRegistrationType" NOT NULL DEFAULT 'UNREGISTERED',
ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "registeredAddress" TEXT,
ADD COLUMN     "stateCode" TEXT;

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "gstRegistrationType" "GstRegistrationType" NOT NULL DEFAULT 'UNREGISTERED',
ADD COLUMN     "stateCode" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "taxClassificationId" TEXT;

-- AlterTable
ALTER TABLE "purchase_items" ADD COLUMN     "cessAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "cessRateSnapshot" DECIMAL(5,2),
ADD COLUMN     "cgstAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "cgstRateSnapshot" DECIMAL(5,2),
ADD COLUMN     "hsnCodeSnapshot" TEXT,
ADD COLUMN     "igstAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "igstRateSnapshot" DECIMAL(5,2),
ADD COLUMN     "sgstAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "sgstRateSnapshot" DECIMAL(5,2),
ADD COLUMN     "taxTreatmentSnapshot" "TaxTreatment";

-- AlterTable
ALTER TABLE "purchase_return_items" ADD COLUMN     "cessAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "cessRateSnapshot" DECIMAL(5,2),
ADD COLUMN     "cgstAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "cgstRateSnapshot" DECIMAL(5,2),
ADD COLUMN     "hsnCodeSnapshot" TEXT,
ADD COLUMN     "igstAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "igstRateSnapshot" DECIMAL(5,2),
ADD COLUMN     "sgstAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "sgstRateSnapshot" DECIMAL(5,2),
ADD COLUMN     "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "taxTreatmentSnapshot" "TaxTreatment";

-- AlterTable
ALTER TABLE "purchase_returns" ADD COLUMN     "buyerGstin" TEXT,
ADD COLUMN     "buyerStateCode" TEXT,
ADD COLUMN     "cessTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "cgstTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "igstTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "placeOfSupplyStateCode" TEXT,
ADD COLUMN     "sellerGstin" TEXT,
ADD COLUMN     "sellerStateCode" TEXT,
ADD COLUMN     "sgstTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "supplyType" "SupplyType",
ADD COLUMN     "taxTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "taxableTotal" DECIMAL(18,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "purchases" ADD COLUMN     "buyerGstin" TEXT,
ADD COLUMN     "buyerStateCode" TEXT,
ADD COLUMN     "cessTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "cgstTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "igstTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "placeOfSupplyStateCode" TEXT,
ADD COLUMN     "sellerGstin" TEXT,
ADD COLUMN     "sellerStateCode" TEXT,
ADD COLUMN     "sgstTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "supplyType" "SupplyType";

-- AlterTable
ALTER TABLE "sales_invoice_items" ADD COLUMN     "cessAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "cessRateSnapshot" DECIMAL(5,2),
ADD COLUMN     "cgstAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "cgstRateSnapshot" DECIMAL(5,2),
ADD COLUMN     "hsnCodeSnapshot" TEXT,
ADD COLUMN     "igstAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "igstRateSnapshot" DECIMAL(5,2),
ADD COLUMN     "sgstAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "sgstRateSnapshot" DECIMAL(5,2),
ADD COLUMN     "taxTreatmentSnapshot" "TaxTreatment";

-- AlterTable
ALTER TABLE "sales_invoices" ADD COLUMN     "buyerGstin" TEXT,
ADD COLUMN     "buyerStateCode" TEXT,
ADD COLUMN     "cessTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "cgstTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "igstTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "placeOfSupplyStateCode" TEXT,
ADD COLUMN     "sellerGstin" TEXT,
ADD COLUMN     "sellerStateCode" TEXT,
ADD COLUMN     "sgstTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "supplyType" "SupplyType";

-- AlterTable
ALTER TABLE "sales_return_items" ADD COLUMN     "cessAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "cessRateSnapshot" DECIMAL(5,2),
ADD COLUMN     "cgstAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "cgstRateSnapshot" DECIMAL(5,2),
ADD COLUMN     "hsnCodeSnapshot" TEXT,
ADD COLUMN     "igstAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "igstRateSnapshot" DECIMAL(5,2),
ADD COLUMN     "sgstAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "sgstRateSnapshot" DECIMAL(5,2),
ADD COLUMN     "taxTreatmentSnapshot" "TaxTreatment";

-- AlterTable
ALTER TABLE "sales_returns" ADD COLUMN     "buyerGstin" TEXT,
ADD COLUMN     "buyerStateCode" TEXT,
ADD COLUMN     "cessTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "cgstTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "igstTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "placeOfSupplyStateCode" TEXT,
ADD COLUMN     "sellerGstin" TEXT,
ADD COLUMN     "sellerStateCode" TEXT,
ADD COLUMN     "sgstTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "supplyType" "SupplyType";

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "gstRegistrationType" "GstRegistrationType" NOT NULL DEFAULT 'UNREGISTERED',
ADD COLUMN     "stateCode" TEXT;

-- AlterTable
ALTER TABLE "taxes" ADD COLUMN     "cessRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "cgstRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "effectiveFrom" DATE,
ADD COLUMN     "effectiveTo" DATE,
ADD COLUMN     "igstRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "sgstRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "treatment" "TaxTreatment" NOT NULL DEFAULT 'TAXABLE';

-- AlterTable
ALTER TABLE "warehouses" ADD COLUMN     "stateCode" TEXT;

-- CreateTable
CREATE TABLE "tax_classifications" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "TaxClassificationKind" NOT NULL DEFAULT 'HSN',
    "code" TEXT NOT NULL,
    "description" TEXT,
    "defaultTaxId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_classifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tax_classifications_companyId_idx" ON "tax_classifications"("companyId");

-- CreateIndex
CREATE INDEX "tax_classifications_companyId_isActive_idx" ON "tax_classifications"("companyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "tax_classifications_companyId_code_key" ON "tax_classifications"("companyId", "code");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_taxClassificationId_fkey" FOREIGN KEY ("taxClassificationId") REFERENCES "tax_classifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_classifications" ADD CONSTRAINT "tax_classifications_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_classifications" ADD CONSTRAINT "tax_classifications_defaultTaxId_fkey" FOREIGN KEY ("defaultTaxId") REFERENCES "taxes"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- BACKFILL 1: component rates for tax masters that pre-date GST splitting.
--
-- Deterministic and lossless. CGST takes the truncated half and SGST takes the
-- remainder, so cgst + sgst = rate EXACTLY at every rate - including one with an
-- odd number of paise, where a naive rate/2 on both sides would lose a paisa.
-- IGST is always the full rate.
--
-- Only rows still at the 0/0/0 default are touched, so re-running changes
-- nothing and a rate a user has already split by hand is never overwritten.
-- ---------------------------------------------------------------------------
UPDATE "taxes"
SET
  "cgstRate" = trunc("rate" / 2, 2),
  "sgstRate" = "rate" - trunc("rate" / 2, 2),
  "igstRate" = "rate"
WHERE "cgstRate" = 0 AND "sgstRate" = 0 AND "igstRate" = 0 AND "rate" > 0;

-- ---------------------------------------------------------------------------
-- BACKFILL 2: purchase returns written before this phase were a pure cost
-- reversal, so their whole grandTotal was taxable value and their tax was zero.
-- That is a fact about those documents, not a guess, so it is safe to record.
-- No historical tax is fabricated: taxTotal stays 0.
-- ---------------------------------------------------------------------------
UPDATE "purchase_returns"
SET "taxableTotal" = "grandTotal"
WHERE "taxableTotal" = 0 AND "taxTotal" = 0;

-- ---------------------------------------------------------------------------
-- SEED: the GST ledger accounts, for every company that already exists.
--
-- Insert-only, ON CONFLICT DO NOTHING, exactly like the Phase 9 chart seed.
-- New companies get the same accounts from initializeCompanyDefaults().
--
-- NOTE ON HISTORY: journals posted before this phase point at 1500 / 2100 and
-- are left completely alone. Those two accounts stay in the chart as the parents
-- of the new component accounts, so an old trial balance still reconciles.
-- ---------------------------------------------------------------------------
INSERT INTO "accounts" ("id", "companyId", "code", "name", "type", "isSystem", "isActive", "description", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(), c."id", a.code, a.name, a.type::"AccountType", true, true, a.description, NOW(), NOW()
FROM "companies" c
CROSS JOIN (
  VALUES
    ('1510', 'Input CGST', 'ASSET', 'Central GST paid on intra-state purchases, recoverable.'),
    ('1520', 'Input SGST', 'ASSET', 'State GST paid on intra-state purchases, recoverable.'),
    ('1530', 'Input IGST', 'ASSET', 'Integrated GST paid on inter-state purchases, recoverable.'),
    ('1540', 'Input Cess', 'ASSET', 'Compensation cess paid on purchases.'),
    ('2110', 'Output CGST', 'LIABILITY', 'Central GST charged on intra-state sales, owed to the authority.'),
    ('2120', 'Output SGST', 'LIABILITY', 'State GST charged on intra-state sales, owed to the authority.'),
    ('2130', 'Output IGST', 'LIABILITY', 'Integrated GST charged on inter-state sales, owed to the authority.'),
    ('2140', 'Output Cess', 'LIABILITY', 'Compensation cess charged on sales.')
) AS a(code, name, type, description)
ON CONFLICT ("companyId", "code") DO NOTHING;

-- Hang the component accounts under the aggregate ones they refine, so a chart
-- of accounts reads as a tree. Idempotent: only rows with no parent are set.
UPDATE "accounts" child
SET "parentId" = parent."id"
FROM "accounts" parent
WHERE child."companyId" = parent."companyId"
  AND child."parentId" IS NULL
  AND (
    (child."code" IN ('1510', '1520', '1530', '1540') AND parent."code" = '1500')
    OR (child."code" IN ('2110', '2120', '2130', '2140') AND parent."code" = '2100')
  );
