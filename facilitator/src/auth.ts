import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { getAllMerchants, MerchantConfig } from './merchantStore.js';
import { isDatabaseConfigured } from './db.js';
import { createLogger } from './logging.js';

const logger = createLogger({ context: 'auth' });

const ADMIN_API_KEY_HASH = process.env.ADMIN_API_KEY_HASH || '';

let merchantCache: MerchantConfig[] = [];
let lastCacheUpdate = 0;
const CACHE_TTL = 60000; // 1 minute

/**
 * Extended request with merchant info
 */
export interface AuthenticatedRequest extends Request {
  merchant?: MerchantConfig;
  isAdmin?: boolean;
}

async function refreshMerchantCache(): Promise<void> {
  const now = Date.now();
  if (now - lastCacheUpdate < CACHE_TTL) {
    return; // Cache still fresh
  }

  if (!isDatabaseConfigured()) {
    logger.warn('Database not configured, merchant authentication disabled');
    return;
  }

  try {
    merchantCache = await getAllMerchants();
    lastCacheUpdate = now;
    logger.info('Merchant cache refreshed', { count: merchantCache.length });
  } catch (error: any) {
    logger.error('Failed to refresh merchant cache', { error: error.message });
  }
}

export async function authenticateMerchant(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const apiKey = req.headers['x-api-key'] as string;

  if (!apiKey) {
    logger.warn('Missing API key', { path: req.path });
    res.status(401).json({ error: 'Missing X-API-Key header' });
    return;
  }

  await refreshMerchantCache();

  let foundMerchant: MerchantConfig | undefined;
  
  for (const merchant of merchantCache) {
    if (merchant.apiKeyHash && bcrypt.compareSync(apiKey, merchant.apiKeyHash)) {
      foundMerchant = merchant;
      break;
    }
  }

  if (!foundMerchant) {
    logger.warn('Invalid API key', { path: req.path });
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }

  if (!foundMerchant.enabled) {
    logger.warn('Merchant disabled', { 
      merchant: foundMerchant.address,
      path: req.path 
    });
    res.status(403).json({ error: 'Merchant account disabled' });
    return;
  }

  if ('approved' in foundMerchant && !foundMerchant.approved) {
    logger.warn('Merchant not approved', { 
      merchant: foundMerchant.address,
      path: req.path 
    });
    res.status(403).json({ error: 'Merchant registration pending approval' });
    return;
  }

  (req as AuthenticatedRequest).merchant = foundMerchant;
  
  logger.info('Merchant authenticated', { 
    merchant: foundMerchant.address,
    name: foundMerchant.name,
    path: req.path
  });

  next();
}

export function authenticateAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const adminKey = req.headers['x-admin-key'] as string;

  if (!adminKey) {
    logger.warn('Missing admin key', { path: req.path });
    res.status(401).json({ error: 'Missing X-Admin-Key header' });
    return;
  }

  if (!ADMIN_API_KEY_HASH) {
    logger.error('Admin API key not configured');
    res.status(500).json({ error: 'Admin authentication not configured' });
    return;
  }

  if (!bcrypt.compareSync(adminKey, ADMIN_API_KEY_HASH)) {
    logger.warn('Invalid admin key', { path: req.path });
    res.status(401).json({ error: 'Invalid admin key' });
    return;
  }

  (req as AuthenticatedRequest).isAdmin = true;
  
  logger.info('Admin authenticated', { path: req.path });

  next();
}

export async function hashApiKey(apiKey: string): Promise<string> {
  return bcrypt.hash(apiKey, 10);
}

export function generateApiKey(): string {
  const crypto = require('crypto');
  return crypto.randomBytes(32).toString('hex');
}
