-- Migration 002: Add merchants table for authentication and management

CREATE TABLE IF NOT EXISTS merchants (
  address TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_key_hash TEXT NOT NULL,
  enabled BOOLEAN DEFAULT true,
  rate_limit INTEGER DEFAULT 50,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_merchants_enabled ON merchants(enabled);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_merchants_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER merchants_updated_at
  BEFORE UPDATE ON merchants
  FOR EACH ROW
  EXECUTE FUNCTION update_merchants_updated_at();

-- Example merchant (commented out - add your own)
-- INSERT INTO merchants (address, name, api_key_hash) VALUES
--   ('0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb', 'Example Merchant', '$2b$10$...');
