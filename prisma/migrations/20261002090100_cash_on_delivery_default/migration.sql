-- Separate from the migration that adds the value: Postgres cannot use a new enum value in the
-- transaction that created it.
ALTER TABLE "orders" ALTER COLUMN "paymentMode" SET DEFAULT 'COD';
