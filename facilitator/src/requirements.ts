import { config, FACILITATOR_ADDRESS, SERVICE_FEE_BPS, GAS_FEE_USDC, USDC_NAME, USDC_VERSION, toLegacyNetworkId } from './config.js';
import type { RequirementsRequest, PaymentRequired } from './types.js';
import type { PaymentRequiredV1 } from '@x402/core/types';

export const DEFAULT_MAX_TIMEOUT_SECONDS = 300;

/**
 * Build a PaymentRequired object that a resource server can return on its 402.
 * payTo is always the facilitator (fee split model); the merchant is identified
 * at settlement time by its API key.
 */
export function generateRequirements(request: RequirementsRequest): PaymentRequired | PaymentRequiredV1 {
  const requestedVersion = request.x402Version ?? request.version ?? request.extra?.x402Version;
  const amount = request.amount || '1000000';
  const url = request.resource?.url || request.extra?.resource || process.env.FACILITATOR_URL || 'http://localhost:3002/resource';
  const description = request.resource?.description || request.extra?.description || request.memo || 'Payment required for resource access';
  const mimeType = request.resource?.mimeType || request.extra?.mimeType || 'application/json';

  const extra = {
    // EIP-712 domain of the token, required by the exact EVM scheme
    name: USDC_NAME,
    version: USDC_VERSION,
    // Facilitator fee disclosure (informational)
    feeBps: SERVICE_FEE_BPS,
    gasFee: GAS_FEE_USDC.toString(),
    ...(request.extra?.merchantAddress && { merchantAddress: request.extra.merchantAddress }),
  };

  if (requestedVersion === 1) {
    return {
      x402Version: 1,
      error: 'Payment required',
      accepts: [
        {
          scheme: 'exact',
          network: toLegacyNetworkId(config.network) as `${string}:${string}`,
          maxAmountRequired: amount,
          resource: url,
          description,
          mimeType,
          outputSchema: (request.extra?.outputSchema ?? {}) as Record<string, unknown>,
          payTo: FACILITATOR_ADDRESS,
          maxTimeoutSeconds: DEFAULT_MAX_TIMEOUT_SECONDS,
          asset: config.usdcAddress,
          extra,
        },
      ],
    };
  }

  return {
    x402Version: 2,
    error: 'Payment required',
    resource: { url, description, mimeType },
    accepts: [
      {
        scheme: 'exact',
        network: config.network as `${string}:${string}`,
        amount,
        asset: config.usdcAddress,
        payTo: FACILITATOR_ADDRESS,
        maxTimeoutSeconds: DEFAULT_MAX_TIMEOUT_SECONDS,
        extra,
      },
    ],
  };
}
