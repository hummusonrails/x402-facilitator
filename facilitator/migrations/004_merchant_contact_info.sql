-- Add email and description columns to merchants table
-- Migration: 004_merchant_contact_info.sql

ALTER TABLE merchants 
ADD COLUMN IF NOT EXISTS email VARCHAR(255),
ADD COLUMN IF NOT EXISTS description TEXT;

-- Add index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_merchants_email ON merchants(email);

-- Update existing merchants to have NULL values (they can be updated manually if needed)
COMMENT ON COLUMN merchants.email IS 'Merchant contact email for notifications';
COMMENT ON COLUMN merchants.description IS 'Merchant application description/use case';
