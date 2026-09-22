-- SaaS subscriptions, sales staff, and the AI bill-import staging layer.
--
-- ADDITIVE AND RELAXING ONLY. No DROP TABLE, no DROP COLUMN, no data deleted,
-- and no existing constraint narrowed. Every new column is nullable or has a
-- default, so every existing row stays valid the moment this runs.
--
-- NOTHING HERE TOUCHES THE ACCOUNTING TABLES. Subscriptions are the platform
-- revenue, not a cost in any shop ledger; bills are a staging area that calls
-- the existing purchase and sales services rather than replacing them.

-- Two new roles for the SaaS operator own people. Existing ADMIN and STAFF keep
-- their exact meaning, so every requireRole('ADMIN') on a shop route is
-- unaffected by this.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'PLATFORM_ADMIN';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SALES_STAFF';

-- A platform user belongs to no shop. Every existing user already has a
-- company, so relaxing NOT NULL cannot invalidate a single row.
ALTER TABLE "users" ALTER COLUMN "companyId" DROP NOT NULL;

-- Granular permissions, for sales staff only. Empty for everyone else.
ALTER TABLE "users" ADD COLUMN "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Onboarding details a sales rep collects. All optional.
ALTER TABLE "companies" ADD COLUMN "ownerName" TEXT;
ALTER TABLE "companies" ADD COLUMN "phone" TEXT;
ALTER TABLE "companies" ADD COLUMN "email" TEXT;
ALTER TABLE "companies" ADD COLUMN "city" TEXT;
ALTER TABLE "companies" ADD COLUMN "pincode" TEXT;
ALTER TABLE "companies" ADD COLUMN "onboardedById" TEXT;

ALTER TABLE "companies"
  ADD CONSTRAINT "companies_onboardedById_fkey"
  FOREIGN KEY ("onboardedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "companies_onboardedById_idx" ON "companies" ("onboardedById");

-- --- the SaaS layer -------------------------------------------------------

CREATE TYPE "DurationUnit" AS ENUM ('DAY', 'MONTH', 'YEAR');
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING', 'ACTIVE', 'EXPIRED', 'CANCELLED');
CREATE TYPE "SubscriptionPaymentMethod" AS ENUM ('CASH', 'UPI', 'BANK', 'OTHER');

CREATE TABLE "subscription_plans" (
    "id"            TEXT NOT NULL,
    "name"          TEXT NOT NULL,
    "description"   TEXT,
    "durationValue" INTEGER NOT NULL,
    "durationUnit"  "DurationUnit" NOT NULL DEFAULT 'MONTH',
    "price"         DECIMAL(18,4) NOT NULL,
    "currency"      TEXT NOT NULL DEFAULT 'INR',
    "isActive"      BOOLEAN NOT NULL DEFAULT true,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,
    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- A plan nobody can pay for, or one that lasts no time, is a data error.
ALTER TABLE "subscription_plans"
  ADD CONSTRAINT "subscription_plans_price_check" CHECK ("price" >= 0);
ALTER TABLE "subscription_plans"
  ADD CONSTRAINT "subscription_plans_duration_check" CHECK ("durationValue" > 0);

CREATE UNIQUE INDEX "subscription_plans_name_key" ON "subscription_plans" ("name");
CREATE INDEX "subscription_plans_isActive_idx" ON "subscription_plans" ("isActive");

CREATE TABLE "subscriptions" (
    "id"                     TEXT NOT NULL,
    "companyId"              TEXT NOT NULL,
    "planId"                 TEXT NOT NULL,
    "planNameSnapshot"       TEXT NOT NULL,
    "priceSnapshot"          DECIMAL(18,4) NOT NULL,
    "currencySnapshot"       TEXT NOT NULL DEFAULT 'INR',
    "durationValueSnapshot"  INTEGER NOT NULL,
    "durationUnitSnapshot"   "DurationUnit" NOT NULL,
    "startDate"              DATE NOT NULL,
    "endDate"                DATE NOT NULL,
    "status"                 "SubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "previousSubscriptionId" TEXT,
    "cancelledAt"            TIMESTAMP(3),
    "cancelReason"           TEXT,
    "createdById"            TEXT NOT NULL,
    "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"              TIMESTAMP(3) NOT NULL,
    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- A period that ends before it starts is a data error, not a business case.
ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_range_check" CHECK ("startDate" <= "endDate");
-- A cancelled subscription must say when it was cancelled.
ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_cancelled_check"
  CHECK ("status" <> 'CANCELLED' OR "cancelledAt" IS NOT NULL);

CREATE INDEX "subscriptions_companyId_status_idx" ON "subscriptions" ("companyId", "status");
CREATE INDEX "subscriptions_status_endDate_idx"  ON "subscriptions" ("status", "endDate");
CREATE INDEX "subscriptions_endDate_idx"         ON "subscriptions" ("endDate");

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "subscription_payments" (
    "id"             TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "amount"         DECIMAL(18,4) NOT NULL,
    "method"         "SubscriptionPaymentMethod" NOT NULL DEFAULT 'CASH',
    "reference"      TEXT,
    "paidAt"         DATE NOT NULL,
    "notes"          TEXT,
    "collectedById"  TEXT NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "subscription_payments_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "subscription_payments"
  ADD CONSTRAINT "subscription_payments_amount_check" CHECK ("amount" > 0);

CREATE INDEX "subscription_payments_subscriptionId_idx" ON "subscription_payments" ("subscriptionId");
CREATE INDEX "subscription_payments_collectedById_paidAt_idx" ON "subscription_payments" ("collectedById", "paidAt");

ALTER TABLE "subscription_payments"
  ADD CONSTRAINT "subscription_payments_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_payments"
  ADD CONSTRAINT "subscription_payments_collectedById_fkey"
  FOREIGN KEY ("collectedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- --- bill import ----------------------------------------------------------

CREATE TYPE "BillDirection" AS ENUM ('IN', 'OUT');
CREATE TYPE "BillStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'REVIEW', 'POSTED', 'FAILED', 'CANCELLED');

CREATE TABLE "bills" (
    "id"               TEXT NOT NULL,
    "companyId"        TEXT NOT NULL,
    "direction"        "BillDirection" NOT NULL,
    "status"           "BillStatus" NOT NULL DEFAULT 'UPLOADED',
    "originalFilename" TEXT NOT NULL,
    "mimeType"         TEXT NOT NULL,
    "fileSize"         INTEGER NOT NULL,
    "storageKey"       TEXT NOT NULL,
    "extraction"       JSONB,
    "extractionModel"  TEXT,
    "extractedAt"      TIMESTAMP(3),
    "extractionError"  TEXT,
    "reviewedData"     JSONB,
    "postedSourceType" TEXT,
    "postedSourceId"   TEXT,
    "postedAt"         TIMESTAMP(3),
    "postedById"       TEXT,
    "cancelledAt"      TIMESTAMP(3),
    "cancelReason"     TEXT,
    "uploadedById"     TEXT NOT NULL,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,
    CONSTRAINT "bills_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "bills" ADD CONSTRAINT "bills_fileSize_check" CHECK ("fileSize" > 0);
-- A posted bill must name the accounting document it became.
ALTER TABLE "bills"
  ADD CONSTRAINT "bills_posted_check"
  CHECK ("status" <> 'POSTED' OR ("postedSourceType" IS NOT NULL AND "postedSourceId" IS NOT NULL));

CREATE UNIQUE INDEX "bills_storageKey_key" ON "bills" ("storageKey");
-- ONE accounting document per bill. Double-posting is impossible at the
-- database, not merely guarded in code. NULLs are unconstrained under a unique
-- index in Postgres, so any number of un-posted bills coexist happily.
CREATE UNIQUE INDEX "bills_companyId_postedSourceType_postedSourceId_key"
  ON "bills" ("companyId", "postedSourceType", "postedSourceId");
CREATE INDEX "bills_companyId_status_idx"    ON "bills" ("companyId", "status");
CREATE INDEX "bills_companyId_createdAt_idx" ON "bills" ("companyId", "createdAt");

ALTER TABLE "bills"
  ADD CONSTRAINT "bills_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bills"
  ADD CONSTRAINT "bills_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bills"
  ADD CONSTRAINT "bills_postedById_fkey"
  FOREIGN KEY ("postedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
