-- Additive, safe migration for QA finding M4 (duplicate-posting concurrency).
--
-- Adds a nullable posting-fingerprint column to bills plus a (companyId,
-- postingFingerprint) UNIQUE index. The fingerprint is a hash of the file
-- checksum + direction + party + grand total + invoice date, set only when a
-- bill is posted without allowDuplicate. Because PostgreSQL treats NULLs as
-- distinct in a unique index, every existing row (NULL fingerprint) stays valid
-- and un-posted bills never conflict; only two bill records that post the same
-- invoice collide, atomically, closing the concurrency gap.
--
-- No data is rewritten and nothing is dropped.

-- AlterTable
ALTER TABLE "bills" ADD COLUMN "postingFingerprint" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "bills_companyId_postingFingerprint_key" ON "bills"("companyId", "postingFingerprint");
