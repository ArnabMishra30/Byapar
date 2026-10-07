-- SHARE LINKS: read-only links a shop sends to a customer or supplier. Additive only.

-- CreateEnum
CREATE TYPE "ShareLinkKind" AS ENUM ('INVOICE', 'CUSTOMER_ACCOUNT', 'SUPPLIER_ACCOUNT');

-- CreateTable
CREATE TABLE "share_links" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "ShareLinkKind" NOT NULL,
    "token" TEXT NOT NULL,
    "salesInvoiceId" TEXT,
    "customerId" TEXT,
    "supplierId" TEXT,
    "includeAccount" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "firstViewedAt" TIMESTAMP(3),
    "lastViewedAt" TIMESTAMP(3),

    CONSTRAINT "share_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "share_links_token_key" ON "share_links"("token");

-- CreateIndex
CREATE INDEX "share_links_companyId_salesInvoiceId_idx" ON "share_links"("companyId", "salesInvoiceId");

-- CreateIndex
CREATE INDEX "share_links_companyId_customerId_idx" ON "share_links"("companyId", "customerId");

-- CreateIndex
CREATE INDEX "share_links_companyId_supplierId_idx" ON "share_links"("companyId", "supplierId");

-- AddForeignKey
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

