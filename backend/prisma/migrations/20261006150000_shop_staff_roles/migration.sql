-- Per-user shop permissions: the role the owner picked. Additive, nullable.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "shopRole" TEXT;

