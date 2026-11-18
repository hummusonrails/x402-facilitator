import { parseEventLogs, parseAbi, type Address, type Hex } from 'viem';
import { config, SETTLEMENT_CONFIRMATION_TIMEOUT_MS } from './config.js';
import { publicClient, walletClient, facilitatorAccount, USDC_ABI, splitEcdsaSignature } from './clients.js';
import { verifyPayment } from './verify.js';
import { computeFeeSplit, type FeeSplit } from './fees.js';
import { createIfAbsent, getPayment, getIdempotencyBinding, setStatus, logPaymentEvent } from './nonceStore.js';
import { chargeFingerprint, type IdempotencyScope } from './idempotency.js';
import { serializeSend } from './sendQueue.js';
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
// Idempotency-Key bindings by merchant and key; `response` is unset while the bound attempt is in flight
const memoryKeys = new Map<string, { fingerprint: string; nonce: string; response?: SettleResponse }>();
const memoryKeyId = (merchantAddress: string, key: string) => `${merchantAddress.toLowerCase()}:${key}`;

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
    return serializeSend(() => walletClient.writeContract({
      address: config.usdcAddress as Address,
      abi: USDC_ABI,
      functionName: 'transferWithAuthorization',
      account: facilitatorAccount,
      chain: config.chain,
      args: [...base, vrs.v, vrs.r, vrs.s],
    }));
  }
  return serializeSend(() => walletClient.writeContract({
    address: config.usdcAddress as Address,
    abi: USDC_ABI,
    functionName: 'transferWithAuthorization',
    account: facilitatorAccount,
    chain: config.chain,
    args: [...base, signature],
  }));
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
    const outgoingHash = await serializeSend(() => walletClient.writeContract({
      address: config.usdcAddress as Address,
      abi: USDC_ABI,
      functionName: 'transfer',
      account: facilitatorAccount,
      chain: config.chain,
      args: [merchantAddress, fees.merchantAmount],
    }));
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

  return successResponse(payer, incomingHash, merchantAddress, fees, forward);
}

function successResponse(
  payer: string,
  incomingHash: Hex,
  merchantAddress: Address,
  fees: FeeSplit,
  forward: { status: 'complete' | 'pending'; transaction?: Hex }
): SettleResponse {
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

/** Marks a response that resolved to an earlier payment under the same Idempotency-Key. */
function asReplay(response: SettleResponse): SettleResponse {
  return { ...response, extra: { ...response.extra, idempotentReplay: true } };
}

// The same authorization, renonced to the payment the key is bound to. The fingerprint
// guarantees payer and value match, which is all the confirmation check reads.
function boundPayment(payment: NormalizedPayment, boundNonce: string): NormalizedPayment {
  return { ...payment, authorization: { ...payment.authorization, nonce: boundNonce as Hex } };
}

const inFlightUnderKey = (payer: string) =>
  failure(payer, Errors.ErrSettlementPending, 'An earlier attempt under this Idempotency-Key is still settling');

/**
 * Resolves a settle whose Idempotency-Key is already bound to a different nonce. Returns
 * undefined when this attempt should settle normally: the key is unbound, bound to this
 * same nonce (nonce reconciliation covers that), or bound to a payment that failed.
 *
 * The new authorization is never broadcast on a replay. It stays unused onchain and lapses
 * at its validBefore, so the buyer is charged once.
 */
async function resolveIdempotentSettle(
  payment: NormalizedPayment,
  merchantAddress: Address,
  scope: IdempotencyScope,
  logger: Logger,
  hooks?: SettleHooks
): Promise<SettleResponse | undefined> {
  const payer = payment.authorization.from;
  const nonce = payment.authorization.nonce;

  if (!useDatabase) {
    const entry = memoryKeys.get(memoryKeyId(merchantAddress, scope.key));
    if (!entry) return undefined;
    if (entry.fingerprint !== scope.fingerprint) return failure(payer, Errors.ErrIdempotencyKeyReused);
    if (entry.nonce === nonce) return undefined;
    if (entry.response?.success) return asReplay(entry.response);
    const pending = pendingIncoming.get(entry.nonce);
    if (pending) {
      const fees = computeFeeSplit(pending.totalAmount);
      if (!fees) return failure(payer, Errors.ErrUnexpectedSettleError);
      logger.info('Reconciling pending settlement bound to the idempotency key', { hash: pending.hash, boundNonce: entry.nonce });
      const result = await completeSettlement(boundPayment(payment, entry.nonce), pending.hash, merchantAddress, fees, logger, hooks);
      entry.response = result;
      return asReplay(result);
    }
    if (!entry.response) return inFlightUnderKey(payer);
    return undefined;
  }

  const binding = await getIdempotencyBinding(merchantAddress, scope.key);
  if (!binding) return undefined;
  if (binding.fingerprint !== scope.fingerprint) return failure(payer, Errors.ErrIdempotencyKeyReused);
  if (binding.nonce === nonce) return undefined;

  const record = await getPayment(binding.nonce);
  if (!record || record.status === 'failed') return undefined;
  if (record.status === 'pending' || !record.incomingTxHash) return inFlightUnderKey(payer);

  const fees = computeFeeSplit(BigInt(record.totalAmount));
  if (!fees) return failure(payer, Errors.ErrUnexpectedSettleError);
  const incomingHash = record.incomingTxHash as Hex;

  if (record.status === 'incoming_submitted') {
    logger.info('Reconciling pending settlement bound to the idempotency key', { hash: incomingHash, boundNonce: binding.nonce });
    return asReplay(await completeSettlement(boundPayment(payment, binding.nonce), incomingHash, merchantAddress, fees, logger, hooks));
  }

  logger.info('Idempotency key resolved to an earlier settlement', { hash: incomingHash, boundNonce: binding.nonce });
  const forward = record.status === 'complete'
    ? { status: 'complete' as const, ...(record.outgoingTxHash && { transaction: record.outgoingTxHash as Hex }) }
    : { status: 'pending' as const, ...(record.outgoingTxHash && { transaction: record.outgoingTxHash as Hex }) };
  return asReplay(successResponse(payer, incomingHash, merchantAddress, fees, forward));
}

export async function settlePayment(
  payment: NormalizedPayment,
  merchantAddress: Address,
  logger: Logger,
  hooks?: SettleHooks,
  idempotencyKey?: string
): Promise<SettleResponse> {
  const payer = payment.authorization.from;
  const nonce = payment.authorization.nonce;

  logger.info('Starting payment settlement', { idempotencyKey });

  const merchant = await getMerchantByAddress(merchantAddress);
  if (!merchant) {
    return failure(payer, Errors.ErrMerchantNotRegistered);
  }
  if (!merchant.enabled) {
    return failure(payer, Errors.ErrMerchantDisabled);
  }

  // A key already bound to another authorization for the same charge resolves to that
  // payment, so a buyer who re-signed after a timeout is not charged a second time.
  const scope: IdempotencyScope | undefined = idempotencyKey
    ? { key: idempotencyKey, fingerprint: chargeFingerprint(payment) }
    : undefined;
  if (scope) {
    const resolved = await resolveIdempotentSettle(payment, merchantAddress, scope, logger, hooks);
    if (resolved) return resolved;
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
    return rememberOutcome(merchantAddress, scope, nonce, await completeSettlement(payment, pending.hash, merchantAddress, fees, logger, hooks));
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
        idempotency: scope,
      });
      if (claim === 'exists') {
        return failure(payer, Errors.ErrNonceAlreadyUsed);
      }
      if (claim === 'key_conflict') {
        return failure(payer, Errors.ErrIdempotencyKeyReused);
      }
      if (claim === 'key_bound') {
        // Another attempt under this key claimed it while this one was verifying
        return (await resolveIdempotentSettle(payment, merchantAddress, scope!, logger, hooks)) ?? inFlightUnderKey(payer);
      }
    } catch (error: any) {
      logger.error('Database error claiming nonce', { error: error.message });
      return failure(payer, Errors.ErrUnexpectedSettleError, 'Failed to record payment');
    }
  } else {
    if (claimedNonces.has(nonce)) {
      return failure(payer, Errors.ErrNonceAlreadyUsed);
    }
    // Checked again after verification, with no await between the check and the bind, since
    // another attempt may have bound the key while this one was verifying
    if (scope) {
      const id = memoryKeyId(merchantAddress, scope.key);
      const entry = memoryKeys.get(id);
      const releasable = !entry || (entry.fingerprint === scope.fingerprint &&
        (entry.nonce === nonce || (entry.response && !entry.response.success && !pendingIncoming.has(entry.nonce))));
      if (!releasable) {
        return (await resolveIdempotentSettle(payment, merchantAddress, scope, logger, hooks)) ?? inFlightUnderKey(payer);
      }
      memoryKeys.set(id, { fingerprint: scope.fingerprint, nonce });
    }
    claimedNonces.add(nonce);
    logger.warn('Using in-memory nonce tracking, not production safe');
  }

  return rememberOutcome(merchantAddress, scope, nonce, await broadcastAndComplete(payment, merchantAddress, fees, logger, hooks));
}

/** Without a database, records the outcome on the key's in-memory binding so replays can resolve to it. */
function rememberOutcome(merchantAddress: Address, scope: IdempotencyScope | undefined, nonce: string, result: SettleResponse): SettleResponse {
  if (!useDatabase && scope) {
    const entry = memoryKeys.get(memoryKeyId(merchantAddress, scope.key));
    if (entry && entry.nonce === nonce) entry.response = result;
  }
  return result;
}

async function broadcastAndComplete(
  payment: NormalizedPayment,
  merchantAddress: Address,
  fees: FeeSplit,
  logger: Logger,
  hooks?: SettleHooks
): Promise<SettleResponse> {
  const payer = payment.authorization.from;
  const nonce = payment.authorization.nonce;

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
