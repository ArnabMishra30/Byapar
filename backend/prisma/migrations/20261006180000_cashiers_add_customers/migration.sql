-- The Cashier role now includes CUSTOMERS_CREATE ("add new customers while
-- billing"). Cashiers set up before this get it too, so every cashier behaves
-- the same. Only users still on the ready-made CASHIER role; a CUSTOM role the
-- owner hand-picked is left exactly as it is. Idempotent.
UPDATE "users"
SET "permissions" = array_append("permissions", 'CUSTOMERS_CREATE')
WHERE "shopRole" = 'CASHIER'
  AND NOT ('CUSTOMERS_CREATE' = ANY("permissions"));
