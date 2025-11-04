import { createPublicClient, http } from 'viem';
import { config } from './config.js';
import { createLogger } from './logging.js';
import { testConnection, isDatabaseConfigured } from './db.js';

const logger = createLogger({ context: 'startup' });

export const USDC_DECIMALS = 6;

const DECIMALS_ABI = [{
  name: 'decimals',
  type: 'function',
  stateMutability: 'view',
  inputs: [],
  outputs: [{ name: '', type: 'uint8' }],
}] as const;

export async function validateChainId(): Promise<void> {
  logger.info('Validating chain ID...');
  
  const publicClient = createPublicClient({
    chain: config.chain,
    transport: http(config.rpcUrl),
  });

  const chainId = await publicClient.getChainId();
  
  if (chainId !== config.chainId) {
    throw new Error(
      `Chain ID mismatch: RPC returned ${chainId}, but config expects ${config.chainId}. ` +
      `Check NETWORK setting and RPC URL.`
    );
  }

  logger.info('Chain ID validated', { chainId, network: config.network });
}

export async function validateTokenDecimals(): Promise<void> {
  logger.info('Validating token decimals...');
  
  const publicClient = createPublicClient({
    chain: config.chain,
    transport: http(config.rpcUrl),
  });

  try {
    const decimals = await publicClient.readContract({
      address: config.usdcAddress as `0x${string}`,
      abi: DECIMALS_ABI,
      functionName: 'decimals',
    });

    if (decimals !== USDC_DECIMALS) {
      throw new Error(
        `Token decimals mismatch: ${config.usdcAddress} has ${decimals} decimals, ` +
        `but we expect ${USDC_DECIMALS}. This is not USDC or wrong token address.`
      );
    }

    logger.info('Token decimals validated', { 
      token: config.usdcAddress, 
      decimals,
    });
  } catch (error: any) {
    if (error.message?.includes('decimals mismatch')) {
      throw error;
    }
    throw new Error(
      `Failed to read decimals from token ${config.usdcAddress}: ${error.message}. ` +
      `Check USDC_ADDRESS configuration.`
    );
  }
}

export async function validateDatabase(): Promise<void> {
  if (!isDatabaseConfigured()) {
    logger.warn('WARNING: DATABASE_URL not configured - using in-memory nonce tracking');
    logger.warn('WARNING: This is NOT safe for production - nonces will be lost on restart!');
    return;
  }
  
  logger.info('Validating database connection...');
  
  const connected = await testConnection();
  if (!connected) {
    throw new Error('Database connection failed. Check DATABASE_URL configuration.');
  }
  
  logger.info('Database connection successful');
}

export async function runStartupValidations(): Promise<void> {
  logger.info('Running startup validations...');
  
  try {
    await validateDatabase();
    await validateChainId();
    await validateTokenDecimals();
    
    logger.info('All startup validations passed');
  } catch (error: any) {
    logger.error('Startup validation failed', { error: error.message });
    throw error;
  }
}
