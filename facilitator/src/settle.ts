import { createWalletClient, createPublicClient, http, WalletClient, PublicClient } from 'viem';
import { Address } from 'viem';
import { verifyPayment } from './verify.js';
import { config, SERVICE_FEE_BPS, GAS_FEE_USDC, MAX_SETTLEMENT_AMOUNT } from './config.js';
import { setStatus, logPaymentEvent } from './nonceStore.js';
import { isDatabaseConfigured } from './db.js';
import { getMerchantByAddress } from './merchantStore.js';
import type { SettleRequest, SettleResponse } from './types.js';
import { Logger } from './logging.js';
import { privateKeyToAccount } from 'viem/accounts';
import { FACILITATOR_PRIVATE_KEY } from './config.js';

const useDatabase = isDatabaseConfigured();

const usedNonces = new Set<string>();

export function markNonceAsUsed(nonce: string): void {
  usedNonces.add(nonce);
}

const TRANSFER_WITH_AUTHORIZATION_ABI = [
  {
    name: 'transferWithAuthorization',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
] as const;

let walletClient: WalletClient | null = null;
let publicClient: PublicClient | null = null;

const facilitatorAccount = privateKeyToAccount(FACILITATOR_PRIVATE_KEY);

function getWalletClient() {
  if (!walletClient) {
    walletClient = createWalletClient({
      account: facilitatorAccount,
      chain: config.chain,
      transport: http(config.rpcUrl),
    });
  }
  return walletClient;
}

function getPublicClient() {
  if (!publicClient) {
    publicClient = createPublicClient({
      chain: config.chain,
      transport: http(config.rpcUrl),
    });
  }
  return publicClient;
}

function calculateFees(merchantAmount: bigint) {
  // Service fee = merchantAmount * SERVICE_FEE_BPS / 10000
  const serviceFee = (merchantAmount * BigInt(SERVICE_FEE_BPS)) / 10000n;
  const gasFee = GAS_FEE_USDC;
  const totalAmount = merchantAmount + serviceFee + gasFee;
  
  return {
    merchantAmount,
    serviceFee,
    gasFee,
    totalAmount,
    facilitatorFee: serviceFee + gasFee,
  };
}

export async function settlePayment(
  request: SettleRequest,
  merchantAddress: Address,
  logger: Logger
): Promise<SettleResponse> {
  const { paymentPayload, paymentRequirements } = request;

  logger.info('Starting payment settlement');

  const verificationResult = await verifyPayment(
    { paymentPayload, paymentRequirements },
    facilitatorAccount.address,
    merchantAddress,
    logger
  );

  if (!verificationResult.valid) {
    logger.warn('Settlement failed: verification failed', {
      reason: verificationResult.invalidReason,
    });
    return {
      success: false,
      error: verificationResult.invalidReason || 'Payment verification failed',
    };
  }

  const requestedToken = paymentRequirements.token.toLowerCase();
  const configuredToken = config.usdcAddress.toLowerCase();

  if (requestedToken !== configuredToken) {
    logger.error('Token mismatch in settle', { requested: requestedToken, configured: configuredToken });
    return {
      success: false,
      error: `Invalid token address. Only ${config.usdcAddress} is supported.`,
    };
  }

  const merchant = await getMerchantByAddress(merchantAddress);
  
  if (!merchant) {
    logger.warn('Merchant not registered', { merchantAddress });
    return {
      success: false,
      error: 'Merchant not registered',
    };
  }
  
  if (!merchant.enabled) {
    logger.warn('Merchant disabled', { merchantAddress });
    return {
      success: false,
      error: 'Merchant account disabled',
    };
  }

  const totalAmount = BigInt(paymentRequirements.amount);
  
  // Guard against underflow: total must be at least gas fee
  if (totalAmount < GAS_FEE_USDC) {
    logger.error('Amount less than gas fee', {
      totalAmount: totalAmount.toString(),
      gasFee: GAS_FEE_USDC.toString(),
    });
    return {
      success: false,
      error: `Amount ${totalAmount} is less than fixed gas fee ${GAS_FEE_USDC}`,
    };
  }
  
  const totalMinusGas = totalAmount - GAS_FEE_USDC;
  const feeMultiplier = 10000n + BigInt(SERVICE_FEE_BPS);
  const merchantAmount = (totalMinusGas * 10000n) / feeMultiplier;
  
  const fees = calculateFees(merchantAmount);
  
  if (fees.totalAmount !== totalAmount) {
    logger.error('Amount calculation mismatch - rejecting', {
      expected: fees.totalAmount.toString(),
      received: totalAmount.toString(),
      merchantAmount: fees.merchantAmount.toString(),
      serviceFee: fees.serviceFee.toString(),
      gasFee: fees.gasFee.toString(),
    });
    return {
      success: false,
      error: `Amount mismatch: expected ${fees.totalAmount}, got ${totalAmount}. Fee calculation error.`,
    };
  }

  if (fees.totalAmount.toString() !== paymentPayload.payload.value) {
    logger.error('Payload value does not match computed total', {
      computedTotal: fees.totalAmount.toString(),
      payloadValue: paymentPayload.payload.value,
    });
    return {
      success: false,
      error: `Payload value ${paymentPayload.payload.value} does not match computed total ${fees.totalAmount}`,
    };
  }

  logger.info('Fee breakdown', {
    merchantAmount: fees.merchantAmount.toString(),
    serviceFee: fees.serviceFee.toString(),
    gasFee: fees.gasFee.toString(),
    facilitatorFee: fees.facilitatorFee.toString(),
    totalAmount: fees.totalAmount.toString(),
  });

  if (fees.totalAmount > MAX_SETTLEMENT_AMOUNT) {
    logger.warn('Amount exceeds maximum', {
      amount: fees.totalAmount.toString(),
      max: MAX_SETTLEMENT_AMOUNT.toString(),
    });
    return {
      success: false,
      error: `Amount exceeds maximum limit of ${MAX_SETTLEMENT_AMOUNT}`,
    };
  }

  const walletClient = getWalletClient();
  const publicClient = getPublicClient();

  try {
    logger.info('Submitting settlement transaction with fee split', {
      method: 'transferWithAuthorization + transfer',
      from: paymentPayload.payload.from,
      toFacilitator: facilitatorAccount.address,
      totalAmount: fees.totalAmount.toString(),
      willForwardToMerchant: merchantAddress,
      merchantAmount: fees.merchantAmount.toString(),
      facilitatorFee: fees.facilitatorFee.toString(),
      token: config.usdcAddress,
    });

    const incomingHash = await walletClient.writeContract({
      address: config.usdcAddress as Address,
      abi: TRANSFER_WITH_AUTHORIZATION_ABI,
      functionName: 'transferWithAuthorization',
      account: facilitatorAccount,
      chain: config.chain,
      args: [
        paymentPayload.payload.from as Address,
        facilitatorAccount.address, // Facilitator receives the total
        fees.totalAmount,
        BigInt(paymentPayload.payload.validAfter),
        BigInt(paymentPayload.payload.validBefore),
        paymentPayload.payload.nonce as `0x${string}`,
        paymentPayload.payload.v,
        paymentPayload.payload.r as `0x${string}`,
        paymentPayload.payload.s as `0x${string}`,
      ],
    });

    logger.info('Incoming transfer submitted', { hash: incomingHash });

    if (useDatabase) {
      await setStatus(paymentPayload.payload.nonce, 'incoming_submitted', {
        incomingTxHash: incomingHash,
      });
      await logPaymentEvent(paymentPayload.payload.nonce, 'incoming_submitted', {
        txHash: incomingHash,
      });
    }

    const incomingReceipt = await publicClient.waitForTransactionReceipt({ 
      hash: incomingHash,
      confirmations: 1,
    });

    if (incomingReceipt.status !== 'success') {
      logger.error('Incoming transfer failed', { receipt: incomingReceipt });
      
      if (useDatabase) {
        await setStatus(paymentPayload.payload.nonce, 'failed');
        await logPaymentEvent(paymentPayload.payload.nonce, 'incoming_failed', {
          txHash: incomingHash,
          blockNumber: incomingReceipt.blockNumber.toString(),
        });
      }
      
      return {
        success: false,
        error: 'Incoming transfer transaction reverted',
      };
    }

    logger.info('Incoming transfer confirmed', {
      hash: incomingReceipt.transactionHash,
      blockNumber: incomingReceipt.blockNumber.toString(),
    });

    if (useDatabase) {
      await setStatus(paymentPayload.payload.nonce, 'incoming_complete');
      await logPaymentEvent(paymentPayload.payload.nonce, 'incoming_complete', {
        txHash: incomingHash,
        blockNumber: incomingReceipt.blockNumber.toString(),
      });
    }

    const transferAbi = [{
      name: 'transfer',
      type: 'function',
      stateMutability: 'nonpayable',
      inputs: [
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
      ],
      outputs: [{ name: '', type: 'bool' }],
    }] as const;

    const outgoingHash = await walletClient.writeContract({
      address: config.usdcAddress as Address,
      abi: transferAbi,
      functionName: 'transfer',
      account: facilitatorAccount,
      chain: config.chain,
      args: [
        merchantAddress,
        fees.merchantAmount,
      ],
    });

    logger.info('Outgoing transfer to merchant submitted', { hash: outgoingHash });

    if (useDatabase) {
      await setStatus(paymentPayload.payload.nonce, 'outgoing_submitted', {
        outgoingTxHash: outgoingHash,
      });
      await logPaymentEvent(paymentPayload.payload.nonce, 'outgoing_submitted', {
        txHash: outgoingHash,
      });
    }

    const outgoingReceipt = await publicClient.waitForTransactionReceipt({ 
      hash: outgoingHash,
      confirmations: 1,
    });

    if (outgoingReceipt.status !== 'success') {
      logger.error('Outgoing transfer to merchant failed', { receipt: outgoingReceipt });
      
      if (useDatabase) {
        await setStatus(paymentPayload.payload.nonce, 'failed');
        await logPaymentEvent(paymentPayload.payload.nonce, 'outgoing_failed', {
          txHash: outgoingHash,
          blockNumber: outgoingReceipt.blockNumber.toString(),
          note: 'Funds received but not forwarded to merchant',
        });
      }
      
      return {
        success: false,
        error: 'Outgoing transfer to merchant reverted',
      };
    }

    logger.info('Outgoing transfer confirmed - settlement complete', {
      incomingHash: incomingReceipt.transactionHash,
      outgoingHash: outgoingReceipt.transactionHash,
      blockNumber: outgoingReceipt.blockNumber.toString(),
      merchantAmount: fees.merchantAmount.toString(),
      facilitatorFee: fees.facilitatorFee.toString(),
    });

    if (useDatabase) {
      await setStatus(paymentPayload.payload.nonce, 'complete');
      await logPaymentEvent(paymentPayload.payload.nonce, 'complete', {
        incomingTxHash: incomingHash,
        outgoingTxHash: outgoingHash,
        incomingBlock: incomingReceipt.blockNumber.toString(),
        outgoingBlock: outgoingReceipt.blockNumber.toString(),
        merchantAmount: fees.merchantAmount.toString(),
        facilitatorFee: fees.facilitatorFee.toString(),
      });
    } else {
      markNonceAsUsed(paymentPayload.payload.nonce);
    }

    return {
      success: true,
      transactionHash: outgoingReceipt.transactionHash, // Final tx (to merchant)
      incomingTransactionHash: incomingReceipt.transactionHash, // User → Facilitator
      outgoingTransactionHash: outgoingReceipt.transactionHash, // Facilitator → Merchant
      blockNumber: Number(outgoingReceipt.blockNumber),
      status: 'confirmed',
      merchantAddress: merchantAddress, // Include for reconciliation
      feeBreakdown: {
        merchantAmount: fees.merchantAmount.toString(),
        serviceFee: fees.serviceFee.toString(),
        gasFee: fees.gasFee.toString(),
        totalAmount: fees.totalAmount.toString(),
      },
    };
  } catch (error: any) {
    logger.error('Settlement transaction failed', { error: error.message });
    return {
      success: false,
      error: `Settlement failed: ${error.message}`,
    };
  }
}
