-- Add INVOICED to quotation lifecycle.
-- The value cannot be used in the same transaction that adds it (PostgreSQL).
ALTER TYPE "QuotationStatus" ADD VALUE IF NOT EXISTS 'INVOICED';
