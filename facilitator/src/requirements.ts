import { randomBytes } from 'crypto';
import { config, FACILITATOR_ADDRESS, SERVICE_FEE_BPS, GAS_FEE_USDC, toLegacyNetworkId } from './config.js';
import type { RequirementsRequest, PaymentRequirementsResponse, PaymentRequirementsAccepts } from './types.js';

function generateNonce(): string {
  return '0x' + randomBytes(32).toString('hex');
}

function calculateDeadline(seconds: number = 3600): number {
  return Math.floor(Date.now() / 1000) + seconds;
}

export function generateRequirements(request: RequirementsRequest): PaymentRequirementsResponse {
  const requestedVersion = request.x402Version ?? request.version ?? request.extra?.x402Version;
  const version = requestedVersion === 1 ? 1 : 2;
  const network = version === 1 ? toLegacyNetworkId(config.network) : config.network;
  const token = config.usdcAddress;
  const recipient = FACILITATOR_ADDRESS;
  const nonce = generateNonce();
  const deadline = calculateDeadline();

  const amount = request.amount || '1000000';
  const memo = request.memo || '';
  // Provide valid URL for resource - use environment variable or default to localhost
  const resource = request.extra?.resource || process.env.FACILITATOR_URL || 'http://localhost:3002/resource';
  const description = request.extra?.description || memo || 'Payment required for resource access';

  const acceptsItem: PaymentRequirementsAccepts = {
    scheme: 'exact',
    network,
    maxAmountRequired: amount,
    asset: token,
    payTo: recipient,
    resource,
    description,
    mimeType: request.extra?.mimeType || 'application/json',
    outputSchema: request.extra?.outputSchema,
    maxTimeoutSeconds: 3600,
    extra: {
      ...request.extra, // Spread client data first
      // Facilitator-controlled fields - always override client values
      feeMode: 'facilitator_split',
      feeBps: SERVICE_FEE_BPS,
      gasBufferWei: GAS_FEE_USDC.toString(),
      nonce,
      deadline,
      ...(request.extra?.merchantAddress && {
        merchantAddress: request.extra.merchantAddress
      })
    }
  };

  const response: PaymentRequirementsResponse = {
    x402Version: version,
    error: 'Payment required',
    accepts: [acceptsItem]
  };

  return response;
}
