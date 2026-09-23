import { getAddress, hashTypedData, recoverAddress, parseAbi, type Address, type Hex } from 'viem';
import { config, FACILITATOR_ADDRESS, USDC_NAME, USDC_VERSION, MAX_SETTLEMENT_AMOUNT } from './config.js';
import { publicClient, facilitatorAccount, USDC_ABI, splitEcdsaSignature } from './clients.js';
import { computeFeeSplit, type FeeSplit } from './fees.js';
import { getPayment } from './nonceStore.js';
import { isDatabaseConfigured } from './db.js';
import type { NormalizedPayment, VerifyResponse } from './types.js';
import * as Errors from './errors.js';
import { Logger } from './logging.js';

const useDatabase = isDatabaseConfigured();

// ERC-6492 wrapped signatures need a factory deployment before settlement,
// which this facilitator does not perform.
const ERC6492_MAGIC_SUFFIX = '6492649264926492649264926492649264926492649264926492649264926492';

// Allow for block time between verify and settle, as the reference implementation does
const VALID_BEFORE_BUFFER_SECONDS = 6n;

const authorizationTypes = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

export interface VerifyResult {
  response: VerifyResponse;
  fees?: FeeSplit;
}

function invalid(reason: string, payer: string, message?: string): VerifyResult {
  return {
    response: {
      isValid: false,
      invalidReason: reason,
      ...(message && { invalidMessage: message }),
      payer,
    },
  };
}

function sameAddress(a: string | undefined, b: string): boolean {
  return !!a && a.toLowerCase() === b.toLowerCase();
}

const ERC1271_ABI = parseAbi(['function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)']);
const ERC1271_MAGIC_VALUE = '0x1626ba7e';

/**
 * Mirror the token's onchain SignatureChecker: ecrecover when the signer has no
 * code, and EIP-1271 only (no ECDSA fallback) when it does. This covers smart
 * wallets and EIP-7702 delegated EOAs, whose delegate decides validity.
 */
async function isValidSignatureStrict(signer: Address, hash: Hex, signature: Hex): Promise<boolean> {
  const code = await publicClient.getCode({ address: signer });
  if (!code || code === '0x') {
    if (signature.length !== 132) return false;
    const recovered = await recoverAddress({ hash, signature });
    return recovered.toLowerCase() === signer.toLowerCase();
  }
  try {
    const result = await publicClient.readContract({
      address: signer,
      abi: ERC1271_ABI,
      functionName: 'isValidSignature',
      args: [hash, signature],
    });
    return result.toLowerCase() === ERC1271_MAGIC_VALUE;
  } catch {
    return false;
  }
}

/**
 * Simulate the transferWithAuthorization call the facilitator would submit at settlement.
 */
export async function simulateTransfer(payment: NormalizedPayment): Promise<void> {
  const { authorization: auth, signature } = payment;
  const vrs = splitEcdsaSignature(signature);
  const base = [auth.from, auth.to, auth.value, auth.validAfter, auth.validBefore, auth.nonce] as const;

  if (vrs) {
    await publicClient.simulateContract({
      address: config.usdcAddress as Address,
      abi: USDC_ABI,
      functionName: 'transferWithAuthorization',
      account: facilitatorAccount,
      args: [...base, vrs.v, vrs.r, vrs.s],
    });
  } else {
    await publicClient.simulateContract({
      address: config.usdcAddress as Address,
      abi: USDC_ABI,
      functionName: 'transferWithAuthorization',
      account: facilitatorAccount,
      args: [...base, signature],
    });
  }
}

/**
 * Verify an exact EVM (eip3009) payment against its requirements.
 *
 * Read-only per the x402 v2 spec (section 7.1): nothing is written to the
 * database or chain. Settlement re-runs these checks before submitting.
 */
export async function verifyPayment(
  payment: NormalizedPayment,
  logger: Logger,
  options: { simulate?: boolean } = {}
): Promise<VerifyResult> {
  const { requirements, accepted, authorization: auth, signature } = payment;
  const payer = auth.from;

  logger.info('Starting payment verification', { x402Version: payment.x402Version });

  if (requirements.scheme !== 'exact' || accepted.scheme !== 'exact') {
    return invalid(Errors.ErrInvalidScheme, payer, `Only the exact scheme is supported`);
  }

  if (requirements.network !== config.network) {
    return invalid(Errors.ErrInvalidNetwork, payer, `This facilitator settles on ${config.network}`);
  }

  if (accepted.network !== requirements.network) {
    return invalid(Errors.ErrNetworkMismatch, payer);
  }

  // v2 payloads echo the accepted requirements; they must be the ones being verified against
  if (payment.x402Version === 2) {
    if (
      accepted.amount !== requirements.amount ||
      !sameAddress(accepted.asset, requirements.asset) ||
      !sameAddress(accepted.payTo, requirements.payTo)
    ) {
      return invalid(Errors.ErrInvalidPaymentRequirements, payer, 'paymentPayload.accepted does not match paymentRequirements');
    }
  }

  if (!sameAddress(requirements.asset, config.usdcAddress)) {
    return invalid(Errors.ErrUnsupportedAsset, payer, `Only ${config.usdcAddress} is supported`);
  }

  // Fee split model: the payer pays the facilitator, which forwards the merchant share
  if (!sameAddress(requirements.payTo, FACILITATOR_ADDRESS)) {
    return invalid(Errors.ErrRecipientMismatch, payer, `payTo must be the facilitator address ${FACILITATOR_ADDRESS}`);
  }

  const { name, version } = requirements.extra as { name?: unknown; version?: unknown };
  if (typeof name !== 'string' || typeof version !== 'string') {
    return invalid(Errors.ErrMissingEip712Domain, payer, 'paymentRequirements.extra must include name and version');
  }
  if (name !== USDC_NAME) {
    return invalid(Errors.ErrTokenNameMismatch, payer, `Expected EIP-712 name "${USDC_NAME}"`);
  }
  if (version !== USDC_VERSION) {
    return invalid(Errors.ErrTokenVersionMismatch, payer, `Expected EIP-712 version "${USDC_VERSION}"`);
  }

  if (signature.toLowerCase().endsWith(ERC6492_MAGIC_SUFFIX)) {
    return invalid(Errors.ErrInvalidSignature, payer, 'ERC-6492 signatures from undeployed wallets are not supported');
  }

  let signatureValid = false;
  try {
    const hash = hashTypedData({
      domain: {
        name,
        version,
        chainId: config.chainId,
        verifyingContract: getAddress(config.usdcAddress),
      },
      types: authorizationTypes,
      primaryType: 'TransferWithAuthorization',
      message: {
        from: auth.from,
        to: auth.to,
        value: auth.value,
        validAfter: auth.validAfter,
        validBefore: auth.validBefore,
        nonce: auth.nonce,
      },
    });
    signatureValid = await isValidSignatureStrict(auth.from, hash, signature);
  } catch (error: any) {
    logger.warn('Signature verification threw', { error: error.message });
  }
  if (!signatureValid) {
    return invalid(Errors.ErrInvalidSignature, payer);
  }

  if (!sameAddress(auth.to, requirements.payTo)) {
    return invalid(Errors.ErrRecipientMismatch, payer, 'authorization.to does not match payTo');
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  if (auth.validBefore < now + VALID_BEFORE_BUFFER_SECONDS) {
    return invalid(Errors.ErrValidBeforeExpired, payer);
  }
  if (auth.validAfter > now) {
    return invalid(Errors.ErrValidAfterInFuture, payer);
  }

  let requiredAmount: bigint;
  try {
    requiredAmount = BigInt(requirements.amount);
  } catch {
    return invalid(Errors.ErrInvalidPaymentRequirements, payer, 'amount must be an integer string');
  }
  if (auth.value !== requiredAmount) {
    return invalid(Errors.ErrAuthorizationValueMismatch, payer);
  }

  const fees = computeFeeSplit(requiredAmount);
  if (!fees) {
    return invalid(Errors.ErrAmountBelowFee, payer, `amount must cover the fixed gas fee`);
  }
  if (requiredAmount > MAX_SETTLEMENT_AMOUNT) {
    return invalid(Errors.ErrAmountAboveLimit, payer, `amount exceeds ${MAX_SETTLEMENT_AMOUNT}`);
  }

  // A settlement for this nonce may be in flight and not yet visible onchain
  if (useDatabase) {
    try {
      if (await getPayment(auth.nonce)) {
        return invalid(Errors.ErrNonceAlreadyUsed, payer);
      }
    } catch (error: any) {
      logger.error('Database error checking nonce', { error: error.message });
      return invalid(Errors.ErrUnexpectedVerifyError, payer);
    }
  }

  try {
    const [nonceUsed, balance] = await Promise.all([
      publicClient.readContract({
        address: config.usdcAddress as Address,
        abi: USDC_ABI,
        functionName: 'authorizationState',
        args: [auth.from, auth.nonce],
      }),
      publicClient.readContract({
        address: config.usdcAddress as Address,
        abi: USDC_ABI,
        functionName: 'balanceOf',
        args: [auth.from],
      }),
    ]);
    if (nonceUsed) {
      return invalid(Errors.ErrNonceAlreadyUsed, payer);
    }
    if (balance < auth.value) {
      return invalid(Errors.ErrInsufficientFunds, payer);
    }
  } catch (error: any) {
    logger.error('Onchain state check failed', { error: error.message });
    return invalid(Errors.ErrUnexpectedVerifyError, payer, error.message);
  }

  if (options.simulate !== false) {
    try {
      await simulateTransfer(payment);
    } catch (error: any) {
      logger.warn('Transfer simulation failed', { error: error.shortMessage || error.message });
      return invalid(Errors.ErrSimulationFailed, payer, error.shortMessage || error.message);
    }
  }

  logger.info('Payment verification successful', { payer, amount: requiredAmount.toString() });

  return {
    response: { isValid: true, payer },
    fees,
  };
}
