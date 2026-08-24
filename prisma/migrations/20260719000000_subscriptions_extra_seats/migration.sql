-- AlterTable
ALTER TABLE "organizations" ADD COLUMN "extra_seats" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN "current_period_end" TIMESTAMP(3),
ADD COLUMN "seat_count" INTEGER;
