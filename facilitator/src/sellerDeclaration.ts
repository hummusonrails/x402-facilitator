import { decodePaymentRequiredHeader } from '@x402/core/http';
import type { DiscoveredResource } from '@x402/extensions/bazaar';
import type { Address } from 'viem';
import { BAZAAR_KEY, REJECTED_ORIGIN_NOT_REGISTERED, evaluateBazaarDeclaration } from './bazaar.js';
import { DISCOVERY_SELLER_TIMEOUT_MS } from './config.js';
import { isOriginRegistered } from './discoveryStore.js';
import type { Logger } from './logging.js';
import type { NormalizedPayment, PaymentRequired } from './types.js';

/**
 * The catalogue entry comes from the seller, not the buyer.
 *
 * The seller SDK checks only the echoed `info` against what it advertised; the echo's
 * `schema`, `routeTemplate` and the whole `resource` block (description, icon, ...) reach
 * the facilitator as the buyer sent them. So once the echo has been validated (the spec
 * requires that) it is not stored. Instead the facilitator asks the seller for the paid URL
 * without paying, reads the `PAYMENT-REQUIRED` header of its 402, and catalogues the
 * declaration, the `resource` block and the matching `accepts` entry from there.
 *
 * The request is only ever made on /settle, after the payment confirmed, to an origin an
 * operator registered to the settling merchant, with GET or HEAD (evaluateBazaarDeclaration
 * refuses any other method), no credentials, no redirects and a short timeout. Only the
 * status and headers are read; the body is cancelled unread.
 */

export const REJECTED_SELLER_NOT_V2 = "seller's 402 is not x402Version 2";
export const REJECTED_SELLER_NO_BAZAAR = "seller's 402 declares no bazaar extension";
export const REJECTED_SELLER_NO_MATCHING_ACCEPTS = "settled requirements are not among the seller's 402 accepts";
const SELLER_DECLARATION_PREFIX = "seller's declaration: ";

export type SellerProbe =
  | { ok: true; paymentRequired: PaymentRequired }
  /** Nothing usable came back; reported `processing`, never `rejected` */
  | { ok: false; reason: string };

/**
 * Request `url` without payment and decode the 402's `PAYMENT-REQUIRED` header. Any failure
 * (timeout, network error, redirect, a status other than 402, a missing or undecodable
 * header) is "no verdict". The reason is for logs only: it describes the seller's response,
 * so it must never be sent back in a rejectedReason.
 */
export async function probeSeller(url: string, method: string, timeoutMs = DISCOVERY_SELLER_TIMEOUT_MS): Promise<SellerProbe> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      redirect: 'manual',
      credentials: 'omit',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error: any) {
    return { ok: false, reason: error?.name === 'TimeoutError' ? 'timed out' : `request failed: ${error?.message}` };
  }
  // Never read the body: everything needed is in the status line and headers
  await response.body?.cancel().catch(() => {});

  if (response.status !== 402) {
    return { ok: false, reason: `status ${response.status}` };
  }
  const header = response.headers.get('payment-required');
  if (!header) {
    return { ok: false, reason: 'no PAYMENT-REQUIRED header' };
  }
  try {
    const decoded = decodePaymentRequiredHeader(header) as unknown;
    if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
      return { ok: false, reason: 'PAYMENT-REQUIRED header is not an object' };
    }
    return { ok: true, paymentRequired: decoded as PaymentRequired };
  } catch {
    return { ok: false, reason: 'PAYMENT-REQUIRED header does not decode' };
  }
}

function sameAddress(a: unknown, b: unknown): boolean {
  return typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
}

/**
 * The seller's `accepts` entry for what was settled. Matched on scheme, network, asset and
 * payTo, not amount: a seller with dynamic pricing may quote a different amount on an unpaid
 * request, and the entry stored is the seller's current advertised terms.
 */
function matchingRequirement(paymentRequired: PaymentRequired, payment: NormalizedPayment): Record<string, unknown> | undefined {
  const settled = payment.requirements;
  const accepts: unknown = (paymentRequired as { accepts?: unknown }).accepts;
  if (!Array.isArray(accepts)) return undefined;
  return accepts.find(
    (entry): entry is Record<string, unknown> =>
      typeof entry === 'object' &&
      entry !== null &&
      entry.scheme === settled.scheme &&
      entry.network === settled.network &&
      sameAddress(entry.asset, settled.asset) &&
      sameAddress(entry.payTo, settled.payTo)
  );
}

export type SellerResolution =
  /** `payment` is the settled payment with the seller's copy in place of the echo, for indexing */
  | { kind: 'resolved'; resource: DiscoveredResource; payment: NormalizedPayment }
  | { kind: 'rejected'; rejectedReason: string }
  | { kind: 'no_verdict' };

/**
 * Turn a validated echo into the seller's own catalogue entry. `echo` is what
 * evaluateBazaarDeclaration accepted from the buyer's payload; only its method is used, to
 * ask the seller. Everything that is catalogued comes from the seller's 402.
 */
export async function resolveSellerDeclaration(
  echo: DiscoveredResource,
  payment: NormalizedPayment,
  merchantAddress: Address,
  logger: Logger
): Promise<SellerResolution> {
  // Only registered origins are ever requested. The URL was screened in the echo evaluation.
  const paidUrl = payment.resource?.url;
  let origin: string;
  try {
    origin = new URL(paidUrl as string).origin;
  } catch {
    return { kind: 'rejected', rejectedReason: REJECTED_ORIGIN_NOT_REGISTERED };
  }
  if (!(await isOriginRegistered(origin, merchantAddress))) {
    logger.warn('Seller not asked for its 402: origin not registered', { origin, merchant: merchantAddress });
    return { kind: 'rejected', rejectedReason: REJECTED_ORIGIN_NOT_REGISTERED };
  }

  const method = 'method' in echo && typeof echo.method === 'string' ? echo.method : 'GET';
  const probe = await probeSeller(paidUrl as string, method);
  if (!probe.ok) {
    logger.warn("No usable 402 from the seller; declaration not catalogued", { url: paidUrl, method, reason: probe.reason });
    return { kind: 'no_verdict' };
  }

  const sellerRequired = probe.paymentRequired;
  if (sellerRequired.x402Version !== 2) {
    return { kind: 'rejected', rejectedReason: REJECTED_SELLER_NOT_V2 };
  }
  const sellerExtensions = (sellerRequired as { extensions?: Record<string, unknown> }).extensions;
  const sellerDeclaration = sellerExtensions?.[BAZAAR_KEY];
  if (sellerDeclaration === undefined) {
    return { kind: 'rejected', rejectedReason: REJECTED_SELLER_NO_BAZAAR };
  }
  const requirement = matchingRequirement(sellerRequired, payment);
  if (!requirement) {
    return { kind: 'rejected', rejectedReason: REJECTED_SELLER_NO_MATCHING_ACCEPTS };
  }

  // The settled payment with the seller's copy in place of the buyer's echo, so the seller's
  // declaration goes through exactly the checks the echo did (size, spec, MCP and method,
  // URL screens, schema in the worker) and indexing stores only seller-supplied fields.
  const sellerResource = (sellerRequired as { resource?: NormalizedPayment['resource'] }).resource;
  const sellerPayment: NormalizedPayment = {
    ...payment,
    resource: sellerResource,
    extensions: { [BAZAAR_KEY]: sellerDeclaration },
    requirements: {
      ...payment.requirements,
      amount: String(requirement.amount),
      asset: String(requirement.asset),
      payTo: String(requirement.payTo),
    },
    raw: {
      paymentPayload: {
        ...payment.raw.paymentPayload,
        resource: sellerResource,
        accepted: requirement,
        extensions: { [BAZAAR_KEY]: sellerDeclaration },
      } as NormalizedPayment['raw']['paymentPayload'],
      paymentRequirements: requirement as NormalizedPayment['raw']['paymentRequirements'],
    },
  };

  const verdict = await evaluateBazaarDeclaration(sellerPayment, logger);
  if (!verdict.declared) {
    return { kind: 'rejected', rejectedReason: REJECTED_SELLER_NO_BAZAAR };
  }
  if (!verdict.valid) {
    if ('deferred' in verdict) return { kind: 'no_verdict' };
    return { kind: 'rejected', rejectedReason: `${SELLER_DECLARATION_PREFIX}${verdict.rejectedReason}` };
  }
  return { kind: 'resolved', resource: verdict.resource, payment: sellerPayment };
}
