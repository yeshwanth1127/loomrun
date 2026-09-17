-- Design workspace: persist default garment visualization prefs on orders.

ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "design_garment_type" TEXT;
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "design_garment_color" TEXT;
