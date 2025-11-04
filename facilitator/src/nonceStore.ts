import { withTx, pool } from './db.js';
import { createHash } from 'crypto';
import { createLogger } from './logging.js';

const logger = createLogger({ context: 'nonceStore' });

export type PaymentStatus =
  | 'pending'
  | 'incoming_submitted'
  | 'incoming_complete'
  | 'outgoing_submitted'
  | 'complete'
  | 'failed';

/**
 * Payment record from database
 */
export interface PaymentRecord {
  nonce: string;
  userAddress: string;
  merchantAddress: string;
  tokenAddress: string;
  network: string;
  totalAmount: string;
  status: PaymentStatus;
  incomingTxHash: string | null;
  outgoingTxHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function nonceLockKey(nonce: string): bigint {
  const hash = createHash('sha256').update(nonce).digest();
  // PostgreSQL advisory locks use int8 (64-bit signed integer)
  // Take first 8 bytes and convert to bigint
  return BigInt('0x' + hash.subarray(0, 8).toString('hex'));
}

export async function createIfAbsent(args: {
  nonce: string;
  userAddress: `0x${string}`;
  merchantAddress: `0x${string}`;
  tokenAddress: `0x${string}`;
  network: string;
  totalAmount: bigint;
}): Promise<'created' | 'exists'> {
  return withTx(async (client) => {
    const lockKey = nonceLockKey(args.nonce);
    
    await client.query('SELECT pg_advisory_xact_lock($1)', [lockKey.toString()]);
    
    // Check if nonce already exists
    const existingRow = await client.query(
      'SELECT nonce FROM payments WHERE nonce = $1',
      [args.nonce]
    );
    
    if (existingRow.rowCount && existingRow.rowCount > 0) {
      logger.warn('Nonce already exists', { nonce: args.nonce });
      return 'exists';
    }
    
    await client.query(
      `INSERT INTO payments 
       (nonce, user_address, merchant_address, token_address, network, total_amount, status)
       VALUES ($1, decode(substr($2, 3), 'hex'), decode(substr($3, 3), 'hex'),
               decode(substr($4, 3), 'hex'), $5, $6, 'pending')`,
      [
        args.nonce,
        args.userAddress,
        args.merchantAddress,
        args.tokenAddress,
        args.network,
        args.totalAmount.toString(),
      ]
    );
    
    logger.info('Payment record created', { 
      nonce: args.nonce,
      merchant: args.merchantAddress,
      amount: args.totalAmount.toString(),
    });
    
    return 'created';
  });
}

export async function setStatus(
  nonce: string,
  status: PaymentStatus,
  hashes?: {
    incomingTxHash?: `0x${string}`;
    outgoingTxHash?: `0x${string}`;
  }
): Promise<void> {
  return withTx(async (client) => {
    const lockKey = nonceLockKey(nonce);
    
    await client.query('SELECT pg_advisory_xact_lock($1)', [lockKey.toString()]);
    
    // Build dynamic UPDATE query
    const sets: string[] = ['status = $2'];
    const values: any[] = [nonce, status];
    
    if (hashes?.incomingTxHash) {
      sets.push(`incoming_tx_hash = decode(substr($${values.length + 1}, 3), 'hex')`);
      values.push(hashes.incomingTxHash);
    }
    
    if (hashes?.outgoingTxHash) {
      sets.push(`outgoing_tx_hash = decode(substr($${values.length + 1}, 3), 'hex')`);
      values.push(hashes.outgoingTxHash);
    }
    
    const sql = `UPDATE payments SET ${sets.join(', ')} WHERE nonce = $1`;
    const result = await client.query(sql, values);
    
    if (result.rowCount === 0) {
      logger.error('Payment not found for status update', { nonce, status });
      throw new Error(`Payment not found: ${nonce}`);
    }
    
    logger.info('Payment status updated', { 
      nonce, 
      status,
      incomingTxHash: hashes?.incomingTxHash,
      outgoingTxHash: hashes?.outgoingTxHash,
    });
  });
}

export async function getPayment(nonce: string): Promise<PaymentRecord | null> {
  const { rows } = await pool.query(
    `SELECT 
       nonce,
       '0x' || encode(user_address, 'hex') as user_address,
       '0x' || encode(merchant_address, 'hex') as merchant_address,
       '0x' || encode(token_address, 'hex') as token_address,
       network,
       total_amount,
       status,
       CASE WHEN incoming_tx_hash IS NOT NULL 
         THEN '0x' || encode(incoming_tx_hash, 'hex') 
         ELSE NULL 
       END as incoming_tx_hash,
       CASE WHEN outgoing_tx_hash IS NOT NULL 
         THEN '0x' || encode(outgoing_tx_hash, 'hex') 
         ELSE NULL 
       END as outgoing_tx_hash,
       created_at,
       updated_at
     FROM payments 
     WHERE nonce = $1`,
    [nonce]
  );
  
  if (rows.length === 0) {
    return null;
  }
  
  const row = rows[0];
  return {
    nonce: row.nonce,
    userAddress: row.user_address,
    merchantAddress: row.merchant_address,
    tokenAddress: row.token_address,
    network: row.network,
    totalAmount: row.total_amount,
    status: row.status as PaymentStatus,
    incomingTxHash: row.incoming_tx_hash,
    outgoingTxHash: row.outgoing_tx_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getIncompletePayments(): Promise<PaymentRecord[]> {
  const { rows } = await pool.query(
    `SELECT 
       nonce,
       '0x' || encode(user_address, 'hex') as user_address,
       '0x' || encode(merchant_address, 'hex') as merchant_address,
       '0x' || encode(token_address, 'hex') as token_address,
       network,
       total_amount,
       status,
       CASE WHEN incoming_tx_hash IS NOT NULL 
         THEN '0x' || encode(incoming_tx_hash, 'hex') 
         ELSE NULL 
       END as incoming_tx_hash,
       CASE WHEN outgoing_tx_hash IS NOT NULL 
         THEN '0x' || encode(outgoing_tx_hash, 'hex') 
         ELSE NULL 
       END as outgoing_tx_hash,
       created_at,
       updated_at
     FROM payments 
     WHERE status IN ('incoming_complete', 'outgoing_submitted')
     ORDER BY created_at ASC`
  );
  
  return rows.map(row => ({
    nonce: row.nonce,
    userAddress: row.user_address,
    merchantAddress: row.merchant_address,
    tokenAddress: row.token_address,
    network: row.network,
    totalAmount: row.total_amount,
    status: row.status as PaymentStatus,
    incomingTxHash: row.incoming_tx_hash,
    outgoingTxHash: row.outgoing_tx_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function logPaymentEvent(
  nonce: string,
  eventType: string,
  eventData?: Record<string, any>
): Promise<void> {
  try {
    await pool.query(
      'INSERT INTO payment_events (nonce, event_type, event_data) VALUES ($1, $2, $3)',
      [nonce, eventType, eventData ? JSON.stringify(eventData) : null]
    );
  } catch (error: any) {
    logger.error('Failed to log payment event', { 
      nonce, 
      eventType, 
      error: error.message 
    });
  }
}
