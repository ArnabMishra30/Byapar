-- More ways a sales rep actually gets paid.
--
-- ADDITIVE ONLY. Adding a value to an enum invalidates no existing row: every
-- payment already recorded keeps the method it has.
--
-- "BANK" already covers a bank transfer. CARD and CHEQUE were missing, and a rep
-- taking either had nothing honest to record it as.

ALTER TYPE "SubscriptionPaymentMethod" ADD VALUE IF NOT EXISTS 'CARD';
ALTER TYPE "SubscriptionPaymentMethod" ADD VALUE IF NOT EXISTS 'CHEQUE';
