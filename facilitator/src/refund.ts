import { Address } from 'viem';
import { createWalletClient, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { config, FACILITATOR_PRIVATE_KEY } from './config.js';
import { getPayment, setStatus, logPaymentEvent } from './nonceStore.js';
import { createLogger } from './logging.js';

const logger = createLogger({ context: 'refund' });

const facilitatorAccount = privateKeyToAccount(FACILITATOR_PRIVATE_KEY);

const TRANSFER_ABI = [{
  name: 'transfer',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
  ],
  outputs: [{ name: '', type: 'bool' }],
}] as const;

export interface RefundRequest {
  nonce: string;
  reason: string;
}

export interface RefundResponse {
  success: boolean;
  refundHash?: string;
  error?: string;
}

export async function executeRefund(
  nonce: string,
  reason: string
): Promise<RefundResponse> {
  try {
    logger.info('Processing refund request', { nonce, reason });

    const payment = await getPayment(nonce);
    
    if (!payment) {
      logger.warn('Payment not found for refund', { nonce });
      return {
        success: false,
        error: 'Payment not found',
      };
    }

    if (payment.status !== 'failed') {
      logger.warn('Payment not in failed status', { 
        nonce, 
        status: payment.status 
      });
      return {
        success: false,
        error: `Payment status is '${payment.status}', only 'failed' payments can be refunded`,
      };
    }

    if (!payment.incomingTxHash) {
      logger.warn('No incoming transaction for refund', { nonce });
      return {
        success: false,
        error: 'No incoming transaction found - user never paid',
      };
    }

    if (payment.outgoingTxHash) {
      logger.warn('Outgoing transaction exists, cannot refund', { 
        nonce,
        outgoingTxHash: payment.outgoingTxHash
      });
      return {
        success: false,
        error: 'Merchant was already paid - cannot refund',
      };
    }

    const walletClient = createWalletClient({
      account: facilitatorAccount,
      chain: config.chain,
      transport: http(config.rpcUrl),
    });

    const publicClient = createPublicClient({
      chain: config.chain,
      transport: http(config.rpcUrl),
    });

    logger.info('Executing refund transfer', {
      nonce,
      userAddress: payment.userAddress,
      amount: payment.totalAmount,
      token: payment.tokenAddress,
    });

    const refundHash = await walletClient.writeContract({
      address: payment.tokenAddress as Address,
      abi: TRANSFER_ABI,
      functionName: 'transfer',
      account: facilitatorAccount,
      chain: config.chain,
      args: [
        payment.userAddress as Address,
        BigInt(payment.totalAmount),
      ],
    });

    logger.info('Refund transaction submitted', { 
      nonce, 
      refundHash 
    });

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: refundHash,
      confirmations: 1,
    });

    if (receipt.status !== 'success') {
      logger.error('Refund transaction reverted', { 
        nonce, 
        refundHash,
        receipt 
      });
      
      await logPaymentEvent(nonce, 'refund_failed', {
        refundHash,
        reason,
        error: 'Transaction reverted',
      });

      return {
        success: false,
        error: 'Refund transaction reverted onchain',
      };
    }

    logger.info('Refund transaction confirmed', {
      nonce,
      refundHash,
      blockNumber: receipt.blockNumber.toString(),
    });

    await logPaymentEvent(nonce, 'refunded', {
      refundHash,
      refundReason: reason,
      blockNumber: receipt.blockNumber.toString(),
      userAddress: payment.userAddress,
      amount: payment.totalAmount,
    });

    return {
      success: true,
      refundHash,
    };
  } catch (error: any) {
    logger.error('Refund execution failed', { 
      nonce, 
      error: error.message 
    });
    
    await logPaymentEvent(nonce, 'refund_failed', {
      reason,
      error: error.message,
    });

    return {
      success: false,
      error: `Refund failed: ${error.message}`,
    };
  }
}
