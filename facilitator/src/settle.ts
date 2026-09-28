import { parseEventLogs, parseAbi, type Address, type Hex } from 'viem';
import { config, SETTLEMENT_CONFIRMATION_TIMEOUT_MS } from './config.js';
import { publicClient, walletClient, facilitatorAccount, USDC_ABI, splitEcdsaSignature } from './clients.js';
import { verifyPayment } from './verify.js';
import { computeFeeSplit, type FeeSplit } from './fees.js';
import { createIfAbsent, getPayment, setStatus, logPaymentEvent } from './nonceStore.js';
import { isDatabaseConfigured } from './db.js';
import { getMerchantByAddress } from './merchantStore.js';
import type { NormalizedPayment, SettleResponse } from './types.js';
import * as Errors from './errors.js';
import { Logger } from './logging.js';

const useDatabase = isDatabaseConfigured();

const TRANSFER_EVENT_ABI = parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)']);

/**
 * Optional callbacks around settlement. `onIncomingConfirmed` runs once the payer's
 * transfer has confirmed with the expected Transfer event (status `incoming_complete`),
 * before the merchant forward. Errors thrown by hooks are logged and never fail the
 * settlement; they exist for side effects such as discovery indexing.
 */
export interface SettleHooks {
  onIncomingConfirmed?: (context: { nonce: string; incomingHash: Hex; merchantAddress: Address }) => Promise<void>;
}

// In-memory fallbacks when no database is configured (not safe across restarts or replicas)
const claimedNonces = new Set<string>();
const pendingIncoming = new Map<string, { hash: Hex; merchantAddress: string; totalAmount: bigint }>();

function failure(payer: string, errorReason: string, errorMessage?: string, transaction = ''): SettleResponse {
  return {
    success: false,
    errorReason,
    ...(errorMessage && { errorMessage }),
    payer,
    transaction,
    network: config.network,
  };
}

async function recordStatus(nonce: string, status: Parameters<typeof setStatus>[1], hashes?: Parameters<typeof setStatus>[2], event?: Record<string, any>) {
  if (!useDatabase) return;
  await setStatus(nonce, status, hashes);
  await logPaymentEvent(nonce, status, event);
}

async function submitIncomingTransfer(payment: NormalizedPayment): Promise<Hex> {
  const { authorization: auth, signature } = payment;
  const vrs = splitEcdsaSignature(signature);
  const base = [auth.from, facilitatorAccount.address, auth.value, auth.validAfter, auth.validBefore, auth.nonce] as const;

  if (vrs) {
    return walletClient.writeContract({
      address: config.usdcAddress as Address,
      abi: USDC_ABI,
      functionName: 'transferWithAuthorization',
      account: facilitatorAccount,
      chain: config.chain,
      args: [...base, vrs.v, vrs.r, vrs.s],
    });
  }
  return walletClient.writeContract({
    address: config.usdcAddress as Address,
    abi: USDC_ABI,
    functionName: 'transferWithAuthorization',
    account: facilitatorAccount,
    chain: config.chain,
    args: [...base, signature],
  });
}

/**
 * Wait for the payer's transfer to confirm, then forward the merchant share.
 * Shared by the normal path and the settlement_pending reconciliation path.
 */
async function completeSettlement(
  payment: NormalizedPayment,
  incomingHash: Hex,
  merchantAddress: Address,
  fees: FeeSplit,
  logger: Logger,
  hooks?: SettleHooks
): Promise<SettleResponse> {
  const payer = payment.authorization.from;
  const nonce = payment.authorization.nonce;

  let incomingReceipt;
  try {
    incomingReceipt = await publicClient.waitForTransactionReceipt({
      hash: incomingHash,
      confirmations: 1,
      timeout: SETTLEMENT_CONFIRMATION_TIMEOUT_MS,
    });
  } catch (error: any) {
    // Broadcast succeeded but confirmation is unknown. Non-terminal: the caller may
    // retry with the same payload, which reconciles against this transaction.
    logger.warn('Receipt wait failed, settlement pending', { hash: incomingHash, error: error.message });
    if (!useDatabase) pendingIncoming.set(nonce, { hash: incomingHash, merchantAddress, totalAmount: fees.totalAmount });
    return failure(payer, Errors.ErrSettlementPending, error.shortMessage || error.message, incomingHash);
  }
  pendingIncoming.delete(nonce);

  if (incomingReceipt.status !== 'success') {
    logger.error('Incoming transfer reverted', { hash: incomingHash });
    await recordStatus(nonce, 'failed', undefined, { txHash: incomingHash, blockNumber: incomingReceipt.blockNumber.toString() });
    return failure(payer, Errors.ErrTransactionFailed, 'transferWithAuthorization reverted', incomingHash);
  }

  // A successful receipt only proves no revert; require the expected USDC Transfer event
  const auth = payment.authorization;
  const transferred = parseEventLogs({ abi: TRANSFER_EVENT_ABI, logs: incomingReceipt.logs, eventName: 'Transfer' }).some(
    (log) =>
      log.address.toLowerCase() === config.usdcAddress.toLowerCase() &&
      log.args.from.toLowerCase() === auth.from.toLowerCase() &&
      log.args.to.toLowerCase() === facilitatorAccount.address.toLowerCase() &&
      log.args.value === auth.value
  );
  if (!transferred) {
    logger.error('Incoming transfer event mismatch', { hash: incomingHash });
    await recordStatus(nonce, 'failed', undefined, { txHash: incomingHash, note: 'transfer event mismatch' });
    return failure(payer, Errors.ErrTransferEventMismatch, undefined, incomingHash);
  }

  logger.info('Incoming transfer confirmed', { hash: incomingHash, blockNumber: incomingReceipt.blockNumber.toString() });
  await recordStatus(nonce, 'incoming_complete', undefined, { txHash: incomingHash, blockNumber: incomingReceipt.blockNumber.toString() });

  if (hooks?.onIncomingConfirmed) {
    try {
      await hooks.onIncomingConfirmed({ nonce, incomingHash, merchantAddress });
    } catch (error: any) {
      logger.error('onIncomingConfirmed hook failed, continuing settlement', { error: error.message });
    }
  }

  // The payer's payment has landed at payTo, so settlement has succeeded from the
  // protocol's point of view. Forwarding to the merchant is facilitator bookkeeping;
  // if it fails the recovery worker retries it from the incoming_complete state.
  let forward: { status: 'complete' | 'pending'; transaction?: Hex } = { status: 'pending' };
  try {
    const outgoingHash = await walletClient.writeContract({
      address: config.usdcAddress as Address,
      abi: USDC_ABI,
      functionName: 'transfer',
      account: facilitatorAccount,
      chain: config.chain,
      args: [merchantAddress, fees.merchantAmount],
    });
    forward = { status: 'pending', transaction: outgoingHash };
    await recordStatus(nonce, 'outgoing_submitted', { outgoingTxHash: outgoingHash }, { txHash: outgoingHash });

    const outgoingReceipt = await publicClient.waitForTransactionReceipt({ hash: outgoingHash, confirmations: 1 });
    if (outgoingReceipt.status === 'success') {
      forward = { status: 'complete', transaction: outgoingHash };
      await recordStatus(nonce, 'complete', undefined, {
        incomingTxHash: incomingHash,
        outgoingTxHash: outgoingHash,
        merchantAmount: fees.merchantAmount.toString(),
        facilitatorFee: fees.facilitatorFee.toString(),
      });
    } else {
      logger.error('Forward to merchant reverted, leaving for recovery', { hash: outgoingHash });
      await recordStatus(nonce, 'incoming_complete', undefined, { note: 'forward reverted', txHash: outgoingHash });
    }
  } catch (error: any) {
    logger.error('Forward to merchant failed, leaving for recovery', { error: error.message });
  }

  logger.info('Settlement complete', { incomingHash, forward });

  return {
    success: true,
    payer,
    transaction: incomingHash,
    network: config.network,
    amount: fees.totalAmount.toString(),
    extra: {
      merchantAddress,
      forward,
      feeBreakdown: {
        merchantAmount: fees.merchantAmount.toString(),
        serviceFee: fees.serviceFee.toString(),
        gasFee: fees.gasFee.toString(),
        totalAmount: fees.totalAmount.toString(),
      },
    },
  };
}

export async function settlePayment(
  payment: NormalizedPayment,
  merchantAddress: Address,
  logger: Logger,
  hooks?: SettleHooks
): Promise<SettleResponse> {
  const payer = payment.authorization.from;
  const nonce = payment.authorization.nonce;

  logger.info('Starting payment settlement');

  const merchant = await getMerchantByAddress(merchantAddress);
  if (!merchant) {
    return failure(payer, Errors.ErrMerchantNotRegistered);
  }
  if (!merchant.enabled) {
    return failure(payer, Errors.ErrMerchantDisabled);
  }

  // Retry of a settle that previously returned settlement_pending: reconcile
  // against the transaction already broadcast instead of submitting again.
  // Only the merchant that started the settlement, for the same amount, may reconcile it.
  const existing = useDatabase ? await getPayment(nonce) : null;
  const pending = existing
    ? existing.status === 'incoming_submitted' && existing.incomingTxHash
      ? { hash: existing.incomingTxHash as Hex, merchantAddress: existing.merchantAddress, totalAmount: BigInt(existing.totalAmount) }
      : undefined
    : pendingIncoming.get(nonce);
  if (pending) {
    const fees = computeFeeSplit(payment.authorization.value);
    if (
      !fees ||
      pending.merchantAddress.toLowerCase() !== merchantAddress.toLowerCase() ||
      pending.totalAmount !== fees.totalAmount ||
      (existing && existing.userAddress.toLowerCase() !== payer.toLowerCase())
    ) {
      return failure(payer, Errors.ErrNonceAlreadyUsed);
    }
    logger.info('Reconciling pending settlement', { hash: pending.hash });
    return completeSettlement(payment, pending.hash, merchantAddress, fees, logger, hooks);
  }

  // Re-verify immediately before settling, including simulation so the
  // facilitator never pays gas for a transfer that would revert.
  const verified = await verifyPayment(payment, logger);
  if (!verified.response.isValid || !verified.fees) {
    return failure(
      payer,
      verified.response.invalidReason ?? Errors.ErrUnexpectedSettleError,
      verified.response.invalidMessage
    );
  }
  const fees = verified.fees;

  // Claim the nonce atomically so concurrent settles of one payload cannot double-submit
  if (useDatabase) {
    try {
      const claim = await createIfAbsent({
        nonce,
        userAddress: payer,
        merchantAddress,
        tokenAddress: config.usdcAddress as Address,
        network: config.network,
        totalAmount: fees.totalAmount,
        merchantAmount: fees.merchantAmount,
        feeAmount: fees.facilitatorFee,
      });
      if (claim === 'exists') {
        return failure(payer, Errors.ErrNonceAlreadyUsed);
      }
    } catch (error: any) {
      logger.error('Database error claiming nonce', { error: error.message });
      return failure(payer, Errors.ErrUnexpectedSettleError, 'Failed to record payment');
    }
  } else {
    if (claimedNonces.has(nonce)) {
      return failure(payer, Errors.ErrNonceAlreadyUsed);
    }
    claimedNonces.add(nonce);
    logger.warn('Using in-memory nonce tracking, not production safe');
  }

  logger.info('Submitting transferWithAuthorization', {
    from: payer,
    totalAmount: fees.totalAmount.toString(),
    merchantAmount: fees.merchantAmount.toString(),
    facilitatorFee: fees.facilitatorFee.toString(),
    merchantAddress,
  });

  let incomingHash: Hex;
  try {
    incomingHash = await submitIncomingTransfer(payment);
  } catch (error: any) {
    logger.error('Failed to submit transferWithAuthorization', { error: error.message });
    await recordStatus(nonce, 'failed', undefined, { error: error.shortMessage || error.message });
    return failure(payer, Errors.ErrInvalidTransactionState, error.shortMessage || error.message);
  }

  await recordStatus(nonce, 'incoming_submitted', { incomingTxHash: incomingHash }, { txHash: incomingHash });

  return completeSettlement(payment, incomingHash, merchantAddress, fees, logger, hooks);
}
