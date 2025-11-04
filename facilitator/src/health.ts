import { config } from './config.js';
import type { HealthResponse } from './types.js';

export function getHealth(facilitatorAddress: string): HealthResponse {
  return {
    status: 'ok',
    network: config.network,
    chainId: config.chainId,
    facilitatorAddress,
    timestamp: Date.now(),
  };
}
