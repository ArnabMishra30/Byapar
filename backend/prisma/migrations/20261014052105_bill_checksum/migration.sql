-- Additive, safe migration for QA finding M3 (duplicate bill-upload detection).
--
-- Adds a nullable SHA-256 checksum column to bills so a re-upload of the same
-- file can be spotted per company, plus a (companyId, checksum) index for the
-- lookup. Nullable with no default: existing rows remain valid and untouched.
-- No data is rewritten and nothing is dropped.
--
-- NOTE: `prisma migrate dev` also wanted to emit unrelated foreign-key
-- (onDelete) and index changes caused by pre-existing drift between
-- schema.prisma and the migration history. Those were deliberately removed from
-- this migration so it stays additive and scoped to M3; the drift is left
-- exactly as it was before this change.

-- AlterTable
ALTER TABLE "bills" ADD COLUMN "checksum" TEXT;

-- CreateIndex
CREATE INDEX "bills_companyId_checksum_idx" ON "bills"("companyId", "checksum");
