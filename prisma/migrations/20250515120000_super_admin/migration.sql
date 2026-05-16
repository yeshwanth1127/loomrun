-- AlterTable
ALTER TABLE "users" ADD COLUMN "is_super_admin" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN "suspended" BOOLEAN NOT NULL DEFAULT false;
