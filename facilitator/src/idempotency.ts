import { createHash } from 'crypto';
import type { NormalizedPayment } from './types.js';

/**
 * Request-scoped idempotency for POST /settle.
 *
 * The EIP-3009 nonce is chosen by the buyer when they sign, so nonce-level replay protection
 * only catches the same authorization arriving twice. A client that times out and signs a
 * fresh authorization for the same purchase produces a second, independently valid nonce.
 * An `Idempotency-Key` header ties those attempts together: the key is bound to the
 * fingerprint of the logical charge and to the payment that settles it, and later attempts
 * under the same key resolve to that payment instead of broadcasting a new transfer.
 */

export const IDEMPOTENCY_HEADER = 'idempotency-key';

const KEY_PATTERN = /^[\x21-\x7e]{1,255}$/;

export type IdempotencyKeyParse =
  | { ok: true; key: string | undefined }
  | { ok: false; message: string };

/** Reads the optional header. Absent is fine; present must be 1 to 255 visible ASCII characters. */
export function parseIdempotencyKey(value: string | string[] | undefined): IdempotencyKeyParse {
  if (value === undefined) return { ok: true, key: undefined };
  if (Array.isArray(value)) return { ok: false, message: 'Idempotency-Key must be sent once' };
  if (!KEY_PATTERN.test(value)) {
    return { ok: false, message: 'Idempotency-Key must be 1 to 255 visible ASCII characters' };
  }
  return { ok: true, key: value };
}

/**
 * Identifies the charge independently of the signed authorization: everything the buyer
 * agreed to pay, and for what, but not the nonce, validity window or signature, which change
 * every time the buyer signs again.
 */
export function chargeFingerprint(payment: NormalizedPayment): string {
  const charge = {
    payer: payment.authorization.from.toLowerCase(),
    value: payment.authorization.value.toString(),
    asset: payment.requirements.asset.toLowerCase(),
    payTo: payment.requirements.payTo.toLowerCase(),
    network: payment.requirements.network,
    resource: payment.resource?.url ?? null,
  };
  return createHash('sha256').update(JSON.stringify(charge)).digest('hex');
}

export interface IdempotencyScope {
  key: string;
  fingerprint: string;
}

/** What the key is already bound to, as seen while claiming a nonce. */
export interface IdempotencyBinding {
  fingerprint: string;
  nonce: string;
}
