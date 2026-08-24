-- Convert expense category from a fixed enum to free text, and add subcategory.

ALTER TABLE "expenses" ADD COLUMN "subcategory" TEXT;

ALTER TABLE "expenses" ALTER COLUMN "category" TYPE TEXT USING "category"::text;

DROP TYPE "ExpenseCategory";
