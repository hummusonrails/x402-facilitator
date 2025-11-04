import { config } from './config';
import type { HealthResponse } from './types';

export function getHealth(): HealthResponse {
  return {
    status: 'ok',
    network: config.network,
    chainId: config.chainId,
    timestamp: Date.now(),
  };
}
