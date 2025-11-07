import { randomBytes } from 'crypto';
import { config, FACILITATOR_ADDRESS, SERVICE_FEE_BPS, GAS_FEE_USDC } from './config.js';
import type { RequirementsRequest, PaymentRequirementsResponse, PaymentRequirementsAccepts } from './types.js';

function networkToSDKNetwork(network: string): string {
  if (network === 'arbitrum') {
    return 'arbitrum';
  } else if (network === 'arbitrum-sepolia') {
    return 'arbitrum-sepolia';
  }
  throw new Error(`Unsupported network: ${network}`);
}

function generateNonce(): string {
  return '0x' + randomBytes(32).toString('hex');
}

function calculateDeadline(seconds: number = 3600): number {
  return Math.floor(Date.now() / 1000) + seconds;
}

export function generateRequirements(request: RequirementsRequest): PaymentRequirementsResponse {
  const network = networkToSDKNetwork(config.network);
  const token = config.usdcAddress;
  const recipient = FACILITATOR_ADDRESS;
  const nonce = generateNonce();
  const deadline = calculateDeadline();

  const amount = request.amount || '1000000';
  const memo = request.memo || '';
  const resource = request.extra?.resource || 'resource';
  const description = request.extra?.description || memo || 'Payment required';

  // Build the accepts object per X402 spec
  const acceptsItem: PaymentRequirementsAccepts = {
    scheme: 'exact',
    network,
    maxAmountRequired: amount,
    asset: token,
    payTo: recipient,
    resource,
    description,
    mimeType: request.extra?.mimeType,
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

  // Return PaymentRequirementsResponse per X402 spec
  const response: PaymentRequirementsResponse = {
    x402Version: 1,
    error: 'Payment required',
    accepts: [acceptsItem]
  };

  return response;
}
