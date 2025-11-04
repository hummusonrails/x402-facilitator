import { pool } from './db';
import { createLogger } from './logging';

const logger = createLogger({ context: 'merchantStore' });

export interface MerchantConfig {
  address: string;
  name: string;
  enabled: boolean;
  approved?: boolean;
  apiKeyHash: string;
  rateLimit?: number;
}

export async function getMerchantByAddress(address: string): Promise<MerchantConfig | null> {
  try {
    const result = await pool.query(
      `SELECT address, name, api_key_hash, enabled, approved, rate_limit
       FROM merchants
       WHERE LOWER(address) = LOWER($1)`,
      [address]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      address: row.address,
      name: row.name,
      enabled: row.enabled,
      approved: row.approved,
      apiKeyHash: row.api_key_hash,
      rateLimit: row.rate_limit,
    };
  } catch (error: any) {
    logger.error('Failed to get merchant by address', {
      address,
      error: error.message,
    });
    return null;
  }
}

export async function getMerchantByApiKey(apiKeyHash: string): Promise<MerchantConfig | null> {
  try {
    const result = await pool.query(
      `SELECT address, name, api_key_hash, enabled, rate_limit
       FROM merchants
       WHERE api_key_hash = $1`,
      [apiKeyHash]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      address: row.address,
      name: row.name,
      enabled: row.enabled,
      apiKeyHash: row.api_key_hash,
      rateLimit: row.rate_limit,
    };
  } catch (error: any) {
    logger.error('Failed to get merchant by API key', {
      error: error.message,
    });
    return null;
  }
}

export async function getAllMerchants(): Promise<MerchantConfig[]> {
  try {
    const result = await pool.query(
      `SELECT address, name, api_key_hash, enabled, approved, rate_limit
       FROM merchants
       ORDER BY created_at DESC`
    );

    return result.rows.map(row => ({
      address: row.address,
      name: row.name,
      enabled: row.enabled,
      approved: row.approved,
      apiKeyHash: row.api_key_hash,
      rateLimit: row.rate_limit,
    }));
  } catch (error: any) {
    logger.error('Failed to get all merchants', {
      error: error.message,
    });
    return [];
  }
}

export async function addMerchant(
  address: string,
  name: string,
  apiKeyHash: string,
  rateLimit: number = 50
): Promise<boolean> {
  try {
    await pool.query(
      `INSERT INTO merchants (address, name, api_key_hash, rate_limit)
       VALUES ($1, $2, $3, $4)`,
      [address, name, apiKeyHash, rateLimit]
    );

    logger.info('Merchant added', { address, name });
    return true;
  } catch (error: any) {
    logger.error('Failed to add merchant', {
      address,
      name,
      error: error.message,
    });
    return false;
  }
}

export async function setMerchantEnabled(
  address: string,
  enabled: boolean
): Promise<boolean> {
  try {
    const result = await pool.query(
      `UPDATE merchants
       SET enabled = $1
       WHERE LOWER(address) = LOWER($2)`,
      [enabled, address]
    );

    if (result.rowCount === 0) {
      logger.warn('Merchant not found for update', { address });
      return false;
    }

    logger.info('Merchant status updated', { address, enabled });
    return true;
  } catch (error: any) {
    logger.error('Failed to update merchant status', {
      address,
      enabled,
      error: error.message,
    });
    return false;
  }
}

export async function updateMerchantApiKey(
  address: string,
  newApiKeyHash: string
): Promise<boolean> {
  try {
    const result = await pool.query(
      `UPDATE merchants
       SET api_key_hash = $1
       WHERE LOWER(address) = LOWER($2)`,
      [newApiKeyHash, address]
    );

    if (result.rowCount === 0) {
      logger.warn('Merchant not found for API key update', { address });
      return false;
    }

    logger.info('Merchant API key updated', { address });
    return true;
  } catch (error: any) {
    logger.error('Failed to update merchant API key', {
      address,
      error: error.message,
    });
    return false;
  }
}

export async function deleteMerchant(address: string): Promise<boolean> {
  try {
    const result = await pool.query(
      `DELETE FROM merchants
       WHERE LOWER(address) = LOWER($1)`,
      [address]
    );

    if (result.rowCount === 0) {
      logger.warn('Merchant not found for deletion', { address });
      return false;
    }

    logger.info('Merchant deleted', { address });
    return true;
  } catch (error: any) {
    logger.error('Failed to delete merchant', {
      address,
      error: error.message,
    });
    return false;
  }
}
