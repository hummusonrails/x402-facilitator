-- Add approval workflow to merchants table

ALTER TABLE merchants 
ADD COLUMN approved BOOLEAN DEFAULT false,
ADD COLUMN requested_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN approved_at TIMESTAMPTZ,
ADD COLUMN approved_by TEXT,
ADD COLUMN rejection_reason TEXT;

-- Update existing merchants to be approved
UPDATE merchants SET approved = true, approved_at = NOW() WHERE enabled = true;

-- Add index for pending merchants
CREATE INDEX idx_merchants_pending ON merchants(approved) WHERE approved = false;

-- Add comment
COMMENT ON COLUMN merchants.approved IS 'Whether merchant has been approved by admin';
COMMENT ON COLUMN merchants.requested_at IS 'When merchant requested registration';
COMMENT ON COLUMN merchants.approved_at IS 'When merchant was approved/rejected';
COMMENT ON COLUMN merchants.approved_by IS 'Admin who approved/rejected';
COMMENT ON COLUMN merchants.rejection_reason IS 'Reason for rejection if applicable';
