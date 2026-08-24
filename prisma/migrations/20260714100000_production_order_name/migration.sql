-- AlterEnum
ALTER TYPE "ProductionActivityType" ADD VALUE 'NAME_CHANGED';

-- AlterTable
ALTER TABLE "production_orders" ADD COLUMN "name" TEXT;
