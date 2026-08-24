-- AlterTable
ALTER TABLE "expenses" ADD COLUMN "lead_id" TEXT;

-- CreateIndex
CREATE INDEX "expenses_lead_id_idx" ON "expenses"("lead_id");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
