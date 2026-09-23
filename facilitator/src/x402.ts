import type { Address, Hex } from 'viem';
import {
  PaymentPayloadV1Schema,
  PaymentPayloadV2Schema,
  PaymentRequirementsV1Schema,
  PaymentRequirementsV2Schema,
} from '@x402/core/schemas';
import { normalizeNetworkId } from './config.js';
import { ExactEvmEip3009PayloadSchema, type NormalizedPayment } from './types.js';
import * as Errors from './errors.js';

export type ParseResult =
  | { ok: true; payment: NormalizedPayment }
  | { ok: false; reason: string; message: string; payer?: string; network?: string };

function firstIssue(error: { errors: { path: (string | number)[]; message: string }[] }): string {
  const issue = error.errors[0];
  return issue ? `${issue.path.join('.') || '(root)'}: ${issue.message}` : 'invalid';
}

/**
 * Parse a facilitator /verify or /settle request body:
 *   { x402Version, paymentPayload, paymentRequirements }
 * Both protocol v2 and legacy v1 shapes are accepted and normalized.
 */
export function parseFacilitatorRequest(body: unknown): ParseResult {
  if (!body || typeof body !== 'object') {
    return { ok: false, reason: Errors.ErrInvalidPayload, message: 'Request body must be a JSON object' };
  }

  const { x402Version: requestVersion, paymentPayload, paymentRequirements } = body as Record<string, any>;

  if (!paymentPayload || typeof paymentPayload !== 'object') {
    return { ok: false, reason: Errors.ErrInvalidPayload, message: 'Missing paymentPayload' };
  }
  if (!paymentRequirements || typeof paymentRequirements !== 'object') {
    return { ok: false, reason: Errors.ErrInvalidPaymentRequirements, message: 'Missing paymentRequirements' };
  }

  const payloadVersion = paymentPayload.x402Version;
  if (payloadVersion !== 1 && payloadVersion !== 2) {
    return { ok: false, reason: Errors.ErrInvalidX402Version, message: `Unsupported x402Version: ${payloadVersion}` };
  }
  if (requestVersion !== undefined && requestVersion !== payloadVersion) {
    return {
      ok: false,
      reason: Errors.ErrInvalidX402Version,
      message: `Request x402Version ${requestVersion} does not match paymentPayload.x402Version ${payloadVersion}`,
    };
  }

  const payer = typeof paymentPayload.payload?.authorization?.from === 'string'
    ? paymentPayload.payload.authorization.from
    : undefined;

  let accepted: NormalizedPayment['accepted'];
  let requirements: NormalizedPayment['requirements'];
  let schemePayload: unknown;

  if (payloadVersion === 2) {
    const p = PaymentPayloadV2Schema.safeParse(paymentPayload);
    if (!p.success) {
      return { ok: false, reason: Errors.ErrInvalidPayload, message: firstIssue(p.error), payer };
    }
    const r = PaymentRequirementsV2Schema.safeParse(paymentRequirements);
    if (!r.success) {
      return { ok: false, reason: Errors.ErrInvalidPaymentRequirements, message: firstIssue(r.error), payer };
    }
    accepted = {
      scheme: p.data.accepted.scheme,
      network: p.data.accepted.network,
      amount: p.data.accepted.amount,
      asset: p.data.accepted.asset,
      payTo: p.data.accepted.payTo,
      extra: p.data.accepted.extra ?? {},
    };
    requirements = {
      scheme: r.data.scheme,
      network: r.data.network,
      amount: r.data.amount,
      asset: r.data.asset,
      payTo: r.data.payTo,
      maxTimeoutSeconds: r.data.maxTimeoutSeconds,
      extra: r.data.extra ?? {},
    };
    schemePayload = p.data.payload;
  } else {
    const p = PaymentPayloadV1Schema.safeParse(paymentPayload);
    if (!p.success) {
      return { ok: false, reason: Errors.ErrInvalidPayload, message: firstIssue(p.error), payer };
    }
    const r = PaymentRequirementsV1Schema.safeParse(paymentRequirements);
    if (!r.success) {
      return { ok: false, reason: Errors.ErrInvalidPaymentRequirements, message: firstIssue(r.error), payer };
    }
    accepted = {
      scheme: p.data.scheme,
      network: normalizeNetworkId(p.data.network),
      extra: {},
    };
    requirements = {
      scheme: r.data.scheme,
      network: normalizeNetworkId(r.data.network),
      amount: r.data.maxAmountRequired,
      asset: r.data.asset,
      payTo: r.data.payTo,
      maxTimeoutSeconds: r.data.maxTimeoutSeconds,
      extra: r.data.extra ?? {},
    };
    schemePayload = p.data.payload;
  }

  const network = requirements.network;

  // Only the eip3009 asset transfer method is implemented (the spec default for exact EVM)
  const transferMethod = requirements.extra.assetTransferMethod ?? accepted.extra.assetTransferMethod;
  if (transferMethod !== undefined && transferMethod !== 'eip3009') {
    return {
      ok: false,
      reason: Errors.ErrUnsupportedAssetTransferMethod,
      message: `Unsupported assetTransferMethod: ${String(transferMethod)}. Only eip3009 is supported.`,
      payer,
      network,
    };
  }

  const e = ExactEvmEip3009PayloadSchema.safeParse(schemePayload);
  if (!e.success) {
    return { ok: false, reason: Errors.ErrInvalidPayload, message: firstIssue(e.error), payer, network };
  }

  return {
    ok: true,
    payment: {
      x402Version: payloadVersion,
      accepted,
      requirements,
      authorization: {
        from: e.data.authorization.from as Address,
        to: e.data.authorization.to as Address,
        value: e.data.authorization.value,
        validAfter: e.data.authorization.validAfter,
        validBefore: e.data.authorization.validBefore,
        nonce: e.data.authorization.nonce as Hex,
      },
      signature: e.data.signature as Hex,
    },
  };
}
