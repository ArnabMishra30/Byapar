-- Reference details (bank, account number, IFSC, UPI ID, holder) on money accounts. Additive.

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "accountNumber" TEXT,
ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "holderName" TEXT,
ADD COLUMN     "ifsc" TEXT,
ADD COLUMN     "upiId" TEXT;

