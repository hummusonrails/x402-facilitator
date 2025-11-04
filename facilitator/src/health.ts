import { config } from './config.js';
import type { HealthResponse } from './types.js';

export function getHealth(): HealthResponse {
  return {
    status: 'ok',
    network: config.network,
    chainId: config.chainId,
    timestamp: Date.now(),
  };
}
