import { Address } from 'viem';
import { config, USDC_NAME, USDC_VERSION, SERVICE_FEE_BPS, GAS_FEE_USDC } from './config.js';
import { verifyTransferAuthorization } from './eip3009.js';
import { createIfAbsent } from './nonceStore.js';
import { isDatabaseConfigured } from './db.js';
import type { VerifyRequest, VerifyResponse, EIP3009Authorization, EIP3009Signature } from './types.js';
import { Logger } from './logging.js';

const usedNonces = new Set<string>();
const useDatabase = isDatabaseConfigured();

export async function verifyPayment(
  request: VerifyRequest,
  facilitatorAddress: Address,
  merchantAddress: Address,
  logger: Logger
): Promise<VerifyResponse> {
  const { paymentPayload, paymentRequirements } = request;

  logger.info('Starting payment verification');

  if (paymentRequirements.scheme !== 'exact') {
    logger.warn('Invalid scheme', { scheme: paymentRequirements.scheme });
    return {
      valid: false,
      invalidReason: `Invalid scheme: ${paymentRequirements.scheme}. Only 'exact' is supported.`,
    };
  }

  if (paymentPayload.scheme !== 'exact') {
    logger.warn('Payload scheme mismatch', { scheme: paymentPayload.scheme });
    return {
      valid: false,
      invalidReason: `Invalid payload scheme: ${paymentPayload.scheme}`,
    };
  }

  if (paymentRequirements.network !== config.network) {
    logger.warn('Invalid network', { 
      requested: paymentRequirements.network, 
      configured: config.network 
    });
    return {
      valid: false,
      invalidReason: `Invalid network: ${paymentRequirements.network}. Only ${config.network} is supported.`,
    };
  }

  if (paymentPayload.network !== config.network) {
    logger.warn('Payload network mismatch', { network: paymentPayload.network });
    return {
      valid: false,
      invalidReason: `Invalid payload network: ${paymentPayload.network}`,
    };
  }

  const requestedToken = paymentRequirements.token.toLowerCase();
  const configuredToken = config.usdcAddress.toLowerCase();

  if (requestedToken !== configuredToken) {
    logger.warn('Invalid token in requirements', { requested: requestedToken, configured: configuredToken });
    return {
      valid: false,
      invalidReason: `Invalid token address. Only ${config.usdcAddress} is supported.`,
    };
  }

  const requestedRecipient = paymentRequirements.recipient.toLowerCase();
  const facilitatorLower = facilitatorAddress.toLowerCase();

  if (requestedRecipient !== facilitatorLower) {
    logger.warn('Invalid recipient in requirements', { 
      requested: requestedRecipient, 
      expected: facilitatorLower 
    });
    return {
      valid: false,
      invalidReason: `Invalid recipient address. Payments must go to facilitator ${facilitatorAddress}`,
    };
  }

  const payloadRecipient = paymentPayload.payload.to.toLowerCase();
  if (payloadRecipient !== facilitatorLower) {
    logger.warn('Payload recipient mismatch', { 
      payloadRecipient, 
      expected: facilitatorLower 
    });
    return {
      valid: false,
      invalidReason: 'Payload recipient does not match facilitator address',
    };
  }

  if (paymentRequirements.amount !== paymentPayload.payload.value) {
    logger.warn('Amount mismatch', {
      requirements: paymentRequirements.amount,
      payload: paymentPayload.payload.value,
    });
    return {
      valid: false,
      invalidReason: 'Amount mismatch between requirements and payload',
    };
  }

  let amount: bigint;
  try {
    amount = BigInt(paymentRequirements.amount);
  } catch (error) {
    logger.warn('Invalid amount format', { amount: paymentRequirements.amount });
    return {
      valid: false,
      invalidReason: 'Invalid amount format',
    };
  }

  if (amount <= 0n) {
    logger.warn('Amount must be positive', { amount: amount.toString() });
    return {
      valid: false,
      invalidReason: 'Amount must be a positive integer',
    };
  }

  const now = Math.floor(Date.now() / 1000);
  if (paymentPayload.payload.validAfter > now) {
    logger.warn('Payment not yet valid', {
      validAfter: paymentPayload.payload.validAfter,
      now,
    });
    return {
      valid: false,
      invalidReason: 'Payment authorization not yet valid',
    };
  }

  if (paymentPayload.payload.validBefore < now) {
    logger.warn('Payment expired', {
      validBefore: paymentPayload.payload.validBefore,
      now,
    });
    return {
      valid: false,
      invalidReason: 'Payment authorization has expired',
    };
  }

  const nonce = paymentPayload.payload.nonce;
  
  // Calculate fee breakdown
  const totalAmount = BigInt(paymentRequirements.amount);
  const totalMinusGas = totalAmount - GAS_FEE_USDC;
  const feeMultiplier = 10000n + BigInt(SERVICE_FEE_BPS);
  const merchantAmount = (totalMinusGas * 10000n) / feeMultiplier;
  const serviceFee = (merchantAmount * BigInt(SERVICE_FEE_BPS)) / 10000n;
  const feeAmount = serviceFee + GAS_FEE_USDC;
  
  if (useDatabase) {
    // Use persistent database storage
    try {
      const result = await createIfAbsent({
        nonce,
        userAddress: paymentPayload.payload.from as `0x${string}`,
        merchantAddress,
        tokenAddress: config.usdcAddress as `0x${string}`,
        network: config.network,
        totalAmount,
        merchantAmount,
        feeAmount,
      });
      
      if (result === 'exists') {
        logger.warn('Nonce already used (database)', { nonce });
        return {
          valid: false,
          invalidReason: 'Nonce has already been used',
        };
      }
      
      logger.info('Nonce registered in database', { nonce });
    } catch (error: any) {
      logger.error('Database error checking nonce', { nonce, error: error.message });
      return {
        valid: false,
        invalidReason: 'Internal error checking nonce uniqueness',
      };
    }
  } else {
    if (usedNonces.has(nonce)) {
      logger.warn('Nonce already used (in-memory)', { nonce });
      return {
        valid: false,
        invalidReason: 'Nonce has already been used',
      };
    }
    usedNonces.add(nonce);
    logger.warn('Using in-memory nonce tracking - not production safe!', { nonce });
  }

  const authorization: EIP3009Authorization = {
    from: paymentPayload.payload.from as Address,
    to: paymentPayload.payload.to as Address,
    value: paymentPayload.payload.value,
    validAfter: paymentPayload.payload.validAfter,
    validBefore: paymentPayload.payload.validBefore,
    nonce: paymentPayload.payload.nonce as `0x${string}`,
  };

  const signature: EIP3009Signature = {
    v: paymentPayload.payload.v,
    r: paymentPayload.payload.r as `0x${string}`,
    s: paymentPayload.payload.s as `0x${string}`,
  };

  logger.info('Verifying EIP-3009 signature');

  const recoveredSigner = await verifyTransferAuthorization(
    authorization,
    signature,
    config.usdcAddress as Address,
    USDC_NAME,
    USDC_VERSION,
    config.chainId
  );

  if (!recoveredSigner) {
    logger.warn('Signature verification failed');
    return {
      valid: false,
      invalidReason: 'Invalid signature',
    };
  }

  if (recoveredSigner.toLowerCase() !== paymentPayload.payload.from.toLowerCase()) {
    logger.warn('Signer mismatch', {
      recovered: recoveredSigner,
      expected: paymentPayload.payload.from,
    });
    return {
      valid: false,
      invalidReason: 'Signature does not match from address',
    };
  }

  logger.info('Payment verification successful', {
    from: paymentPayload.payload.from,
    amount: amount.toString(),
  });

  return {
    valid: true,
  };
}

export function markNonceAsUsed(nonce: string): void {
  usedNonces.add(nonce);
}
