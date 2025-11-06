import { config as loadEnv } from 'dotenv';
import { arbitrum, arbitrumSepolia } from 'viem/chains';
import type { Chain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

loadEnv();

export enum Network {
  ARBITRUM = 'arbitrum',
  ARBITRUM_SEPOLIA = 'arbitrum-sepolia',
}

export const CHAIN_ID_ARBITRUM = 42161;
export const CHAIN_ID_ARBITRUM_SEPOLIA = 421614;

export const USDC_ADDRESS_ARBITRUM = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
export const USDC_ADDRESS_ARBITRUM_SEPOLIA = process.env.USDC_ADDRESS || '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d';

export const USDC_NAME = 'USD Coin';
export const USDC_VERSION = '2';
interface NetworkConfig {
  network: Network;
  chainId: number;
  chain: Chain;
  rpcUrl: string;
  usdcAddress: string;
}

const activeNetwork = (process.env.NETWORK || Network.ARBITRUM_SEPOLIA) as Network;

if (!Object.values(Network).includes(activeNetwork)) {
  throw new Error(`Invalid NETWORK: ${activeNetwork}. Must be one of: ${Object.values(Network).join(', ')}`);
}

const networkConfigs: Record<Network, NetworkConfig> = {
  [Network.ARBITRUM]: {
    network: Network.ARBITRUM,
    chainId: CHAIN_ID_ARBITRUM,
    chain: arbitrum,
    rpcUrl: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
    usdcAddress: USDC_ADDRESS_ARBITRUM,
  },
  [Network.ARBITRUM_SEPOLIA]: {
    network: Network.ARBITRUM_SEPOLIA,
    chainId: CHAIN_ID_ARBITRUM_SEPOLIA,
    chain: arbitrumSepolia,
    rpcUrl: process.env.ARBITRUM_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc',
    usdcAddress: USDC_ADDRESS_ARBITRUM_SEPOLIA,
  },
};

export const config = networkConfigs[activeNetwork];

let privateKey = process.env.EVM_PRIVATE_KEY || process.env.FACILITATOR_PRIVATE_KEY || process.env.PRIVATE_KEY || '';

if (!privateKey) {
  throw new Error('Missing FACILITATOR_PRIVATE_KEY or EVM_PRIVATE_KEY environment variable');
}

if (!privateKey.startsWith('0x')) {
  privateKey = `0x${privateKey}`;
}

if (privateKey.length !== 66) {
  throw new Error(`Invalid FACILITATOR_PRIVATE_KEY format: expected 66 characters (0x + 64 hex), got ${privateKey.length}`);
}

const hexPattern = /^0x[0-9a-fA-F]{64}$/;
if (!hexPattern.test(privateKey)) {
  throw new Error('Invalid FACILITATOR_PRIVATE_KEY format: must contain only hexadecimal characters (0-9, a-f, A-F)');
}

export const FACILITATOR_PRIVATE_KEY = privateKey as `0x${string}`;

const facilitatorAccount = privateKeyToAccount(FACILITATOR_PRIVATE_KEY);
export const FACILITATOR_ADDRESS = facilitatorAccount.address as `0x${string}`;

export const PORT = parseInt(process.env.PORT || '3002', 10);
export const BODY_SIZE_LIMIT = '100kb';
export const MAX_SETTLEMENT_AMOUNT = BigInt(process.env.MAX_SETTLEMENT_AMOUNT || '1000000000');
export const RECOVERY_INTERVAL_MS = parseInt(process.env.RECOVERY_INTERVAL_MS || '300000', 10);
export const SERVICE_FEE_BPS = parseInt(process.env.SERVICE_FEE_BPS || '50', 10);
export const MAX_SERVICE_FEE_BPS = parseInt(process.env.MAX_SERVICE_FEE_BPS || '500', 10);
export const GAS_FEE_USDC = BigInt(process.env.GAS_FEE_USDC || '100000');
export const MAX_GAS_FEE_USDC = BigInt(process.env.MAX_GAS_FEE_USDC || '1000000');

if (SERVICE_FEE_BPS > MAX_SERVICE_FEE_BPS) {
  throw new Error(`SERVICE_FEE_BPS (${SERVICE_FEE_BPS}) exceeds MAX_SERVICE_FEE_BPS (${MAX_SERVICE_FEE_BPS})`);
}

if (GAS_FEE_USDC > MAX_GAS_FEE_USDC) {
  throw new Error(`GAS_FEE_USDC (${GAS_FEE_USDC}) exceeds MAX_GAS_FEE_USDC (${MAX_GAS_FEE_USDC})`);
}

export const ALLOW_CLIENT_RECIPIENT = process.env.ALLOW_CLIENT_RECIPIENT === 'true';

export const allNetworkConfigs = networkConfigs;
