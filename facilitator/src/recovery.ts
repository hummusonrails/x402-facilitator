import { Address } from 'viem';
import { getIncompletePayments, setStatus, logPaymentEvent, PaymentRecord } from './nonceStore.js';
import { createLogger } from './logging.js';
import { config } from './config.js';
import { createWalletClient, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { FACILITATOR_PRIVATE_KEY } from './config.js';

const logger = createLogger({ context: 'recovery' });

const facilitatorAccount = privateKeyToAccount(FACILITATOR_PRIVATE_KEY);

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function retryOutgoingTransfer(
  payment: PaymentRecord,
  maxRetries = 3
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  const walletClient = createWalletClient({
    account: facilitatorAccount,
    chain: config.chain,
    transport: http(config.rpcUrl),
  });

  const publicClient = createPublicClient({
    chain: config.chain,
    transport: http(config.rpcUrl),
  });

  // ERC-20 transfer ABI
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

  // Use the merchant amount stored in the database
  const merchantAmount = BigInt(payment.merchantAmount);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info('Retrying outgoing transfer', {
        nonce: payment.nonce,
        attempt,
        maxRetries,
        merchantAddress: payment.merchantAddress,
        merchantAmount: merchantAmount.toString(),
      });

      const outgoingHash = await walletClient.writeContract({
        address: payment.tokenAddress as Address,
        abi: transferAbi,
        functionName: 'transfer',
        account: facilitatorAccount,
        chain: config.chain,
        args: [
          payment.merchantAddress as Address,
          merchantAmount,
        ],
      });

      logger.info('Outgoing transfer submitted', {
        nonce: payment.nonce,
        hash: outgoingHash,
        attempt,
      });

      await setStatus(payment.nonce, 'outgoing_submitted', {
        outgoingTxHash: outgoingHash,
      });

      await logPaymentEvent(payment.nonce, 'recovery_outgoing_submitted', {
        txHash: outgoingHash,
        attempt,
      });

      const receipt = await publicClient.waitForTransactionReceipt({
        hash: outgoingHash,
        confirmations: 1,
      });

      if (receipt.status === 'success') {
        logger.info('Outgoing transfer confirmed', {
          nonce: payment.nonce,
          hash: outgoingHash,
          blockNumber: receipt.blockNumber.toString(),
        });

        await setStatus(payment.nonce, 'complete');
        await logPaymentEvent(payment.nonce, 'recovery_complete', {
          outgoingTxHash: outgoingHash,
          blockNumber: receipt.blockNumber.toString(),
          attempts: attempt,
        });

        return {
          success: true,
          txHash: outgoingHash,
        };
      } else {
        logger.error('Outgoing transfer reverted', {
          nonce: payment.nonce,
          hash: outgoingHash,
          attempt,
        });

        if (attempt === maxRetries) {
          await setStatus(payment.nonce, 'failed');
          await logPaymentEvent(payment.nonce, 'recovery_failed', {
            txHash: outgoingHash,
            attempts: maxRetries,
            note: 'All retry attempts exhausted',
          });

          return {
            success: false,
            error: 'Transaction reverted after all retries',
          };
        }
      }
    } catch (error: any) {
      logger.error('Outgoing transfer attempt failed', {
        nonce: payment.nonce,
        attempt,
        error: error.message,
      });

      if (attempt === maxRetries) {
        await setStatus(payment.nonce, 'failed');
        await logPaymentEvent(payment.nonce, 'recovery_failed', {
          attempts: maxRetries,
          error: error.message,
          note: 'All retry attempts exhausted',
        });

        return {
          success: false,
          error: error.message,
        };
      }

      const delay = Math.pow(2, attempt) * 1000;
      logger.info('Waiting before retry', {
        nonce: payment.nonce,
        attempt,
        delayMs: delay,
      });
      await sleep(delay);
    }
  }

  return {
    success: false,
    error: 'Unexpected retry loop exit',
  };
}

export async function resumeIncompleteSettlements(): Promise<void> {
  try {
    logger.info('Checking for incomplete settlements...');

    const incomplete = await getIncompletePayments();

    if (incomplete.length === 0) {
      logger.info('No incomplete settlements found');
      return;
    }

    logger.warn('Found incomplete settlements', { count: incomplete.length });

    for (const payment of incomplete) {
      logger.info('Processing incomplete payment', {
        nonce: payment.nonce,
        status: payment.status,
        merchantAddress: payment.merchantAddress,
        createdAt: payment.createdAt,
      });

      await logPaymentEvent(payment.nonce, 'recovery_started', {
        status: payment.status,
        incomingTxHash: payment.incomingTxHash,
      });

      if (payment.status === 'incoming_complete') {
        const result = await retryOutgoingTransfer(payment);

        if (result.success) {
          logger.info('Successfully recovered payment', {
            nonce: payment.nonce,
            txHash: result.txHash,
          });
        } else {
          logger.error('Failed to recover payment', {
            nonce: payment.nonce,
            error: result.error,
          });
        }
      } else if (payment.status === 'outgoing_submitted') {
        logger.info('Checking onchain status for outgoing_submitted', {
          nonce: payment.nonce,
          outgoingTxHash: payment.outgoingTxHash,
        });

        if (payment.outgoingTxHash) {
          const publicClient = createPublicClient({
            chain: config.chain,
            transport: http(config.rpcUrl),
          });

          try {
            const receipt = await publicClient.getTransactionReceipt({
              hash: payment.outgoingTxHash as `0x${string}`,
            });

            if (receipt.status === 'success') {
              logger.info('Outgoing transaction already confirmed', {
                nonce: payment.nonce,
                blockNumber: receipt.blockNumber.toString(),
              });

              await setStatus(payment.nonce, 'complete');
              await logPaymentEvent(payment.nonce, 'recovery_complete', {
                outgoingTxHash: payment.outgoingTxHash,
                blockNumber: receipt.blockNumber.toString(),
                note: 'Transaction was already confirmed onchain',
              });
            } else {
              logger.warn('Outgoing transaction reverted, retrying', {
                nonce: payment.nonce,
              });

              const result = await retryOutgoingTransfer(payment);
              if (!result.success) {
                logger.error('Retry failed', {
                  nonce: payment.nonce,
                  error: result.error,
                });
              }
            }
          } catch (error: any) {
            logger.error('Failed to check transaction status', {
              nonce: payment.nonce,
              error: error.message,
            });

            const result = await retryOutgoingTransfer(payment);
            if (!result.success) {
              logger.error('Retry failed', {
                nonce: payment.nonce,
                error: result.error,
              });
            }
          }
        }
      }
    }

    logger.info('Incomplete settlement recovery complete', {
      processed: incomplete.length,
    });
  } catch (error: any) {
    logger.error('Error during settlement recovery', {
      error: error.message,
      stack: error.stack,
    });
  }
}

export function startRecoveryWorker(intervalMs = 5 * 60 * 1000): NodeJS.Timeout {
  logger.info('Starting recovery worker', { intervalMs });

  resumeIncompleteSettlements().catch(error => {
    logger.error('Initial recovery failed', { error: error.message });
  });

  return setInterval(() => {
    resumeIncompleteSettlements().catch(error => {
      logger.error('Periodic recovery failed', { error: error.message });
    });
  }, intervalMs);
}
