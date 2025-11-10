-- Migration 005: Add fee tracking columns to payments table
-- Adds merchant_amount and fee_amount columns to track fee breakdown

-- Add new columns as nullable first
ALTER TABLE payments 
  ADD COLUMN IF NOT EXISTS merchant_amount numeric(78,0),
  ADD COLUMN IF NOT EXISTS fee_amount numeric(78,0);

-- Backfill existing rows: assume no fees were charged (merchant gets full amount)
UPDATE payments 
SET 
  merchant_amount = total_amount,
  fee_amount = 0
WHERE merchant_amount IS NULL;

-- Make columns NOT NULL now that they're backfilled
ALTER TABLE payments 
  ALTER COLUMN merchant_amount SET NOT NULL,
  ALTER COLUMN fee_amount SET NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN payments.merchant_amount IS 'Amount the merchant receives (total_amount - fee_amount)';
COMMENT ON COLUMN payments.fee_amount IS 'Facilitator fee (service fee + gas fee)';
