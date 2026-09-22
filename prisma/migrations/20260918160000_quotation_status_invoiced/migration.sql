-- Add INVOICED to quotation lifecycle
ALTER TYPE "QuotationStatus" ADD VALUE IF NOT EXISTS 'INVOICED';

-- Reconcile: quotations that already have a linked invoice row become INVOICED.
-- Only when an explicit source_quotation_id relationship exists.
UPDATE "quotations" q
SET "status" = 'INVOICED'
WHERE q."invoice_number" IS NULL
  AND q."status" <> 'INVOICED'
  AND EXISTS (
    SELECT 1
    FROM "quotations" inv
    WHERE inv."source_quotation_id" = q."id"
      AND inv."invoice_number" IS NOT NULL
  );
