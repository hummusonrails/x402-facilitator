import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

export async function getPayments(limit = 50, offset = 0) {
  const { rows } = await pool.query(
    `SELECT 
       nonce,
       '0x' || encode(user_address, 'hex') as user_address,
       '0x' || encode(merchant_address, 'hex') as merchant_address,
       total_amount,
       merchant_amount,
       fee_amount,
       status,
       '0x' || encode(incoming_tx_hash, 'hex') as incoming_tx_hash,
       '0x' || encode(outgoing_tx_hash, 'hex') as outgoing_tx_hash,
       created_at,
       updated_at
     FROM payments
     ORDER BY created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows;
}

export async function getPaymentByNonce(nonce: string) {
  const { rows } = await pool.query(
    `SELECT 
       nonce,
       '0x' || encode(user_address, 'hex') as user_address,
       '0x' || encode(merchant_address, 'hex') as merchant_address,
       total_amount,
       status,
       '0x' || encode(incoming_tx_hash, 'hex') as incoming_tx_hash,
       '0x' || encode(outgoing_tx_hash, 'hex') as outgoing_tx_hash,
       created_at,
       updated_at
     FROM payments
     WHERE nonce = $1`,
    [nonce]
  );
  return rows[0] || null;
}

export async function getStats() {
  const { rows } = await pool.query(
    `SELECT 
       status,
       COUNT(*) as count,
       SUM(total_amount) as total_volume,
       COALESCE(SUM(fee_amount), 0) as total_fees
     FROM payments
     GROUP BY status`
  );
  return rows;
}

export async function getTotalFees() {
  const { rows } = await pool.query(
    `SELECT 
       COALESCE(SUM(fee_amount), 0) as total_fees
     FROM payments
     WHERE status = 'complete'`
  );
  return rows[0]?.total_fees || '0';
}
