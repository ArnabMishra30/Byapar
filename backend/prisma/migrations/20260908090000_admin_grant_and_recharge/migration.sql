-- Manual subscription grants and offline recharges, performed by a platform admin.
--
-- ADDITIVE AND BACKWARD COMPATIBLE. No table dropped, no column dropped, no data
-- deleted, no existing constraint narrowed. Every new column is nullable or has
-- a default, so every subscription and payment already recorded stays valid and
-- keeps its exact meaning.

-- How a subscription came to exist. Everything sold before this migration was a
-- normal sale, which is why SALE is the default: existing rows are correct
-- without being touched.
CREATE TYPE "SubscriptionOrigin" AS ENUM ('SALE', 'ADMIN_GRANT');

ALTER TABLE "subscriptions"
  ADD COLUMN "origin" "SubscriptionOrigin" NOT NULL DEFAULT 'SALE';

-- Why an admin granted it. Required by the application for a grant, nullable in
-- the database because every existing row predates the concept.
ALTER TABLE "subscriptions" ADD COLUMN "grantReason" TEXT;

-- Two more ways money can be recorded, neither of which is a payment gateway.
--
--   MANUAL       cash or a transfer collected offline and recorded afterwards.
--   ADMIN_GRANT  no money changed hands at all - a promotional or goodwill
--                subscription. Kept distinct from a zero-rupee "payment", which
--                would misrepresent a gift as a transaction.
ALTER TYPE "SubscriptionPaymentMethod" ADD VALUE IF NOT EXISTS 'MANUAL';
ALTER TYPE "SubscriptionPaymentMethod" ADD VALUE IF NOT EXISTS 'ADMIN_GRANT';

-- A granted subscription must say why. Enforced only for rows created from now
-- on: NOT VALID skips the check against existing rows, which have no reason and
-- never needed one.
ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_grant_reason_required"
  CHECK ("origin" <> 'ADMIN_GRANT' OR "grantReason" IS NOT NULL)
  NOT VALID;

-- Finding a shop's grants, for the audit trail on its detail page.
CREATE INDEX IF NOT EXISTS "subscriptions_companyId_origin_idx"
  ON "subscriptions" ("companyId", "origin");
