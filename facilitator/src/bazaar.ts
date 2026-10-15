import {
  BAZAAR,
  extractDiscoveryInfo,
  validateDiscoveryExtensionSpec,
  type DiscoveredResource,
} from '@x402/extensions/bazaar';
import type { Address } from 'viem';
import type { Response } from 'express';
import type { NormalizedPayment } from './types.js';
import { upsertDiscoveryResource, type DiscoveryMetadata, type UpsertOutcome } from './discoveryStore.js';
import { validateDeclarationSchema } from './schemaGuard.js';
import { screenResourceUrl } from './resourceUrl.js';
import { DISCOVERY_ALLOW_PRIVATE_RESOURCE_URLS, DISCOVERY_MAX_DECLARATION_BYTES } from './config.js';
import type { Logger } from './logging.js';

/**
 * Bazaar discovery extension (https://docs.x402.org/extensions/bazaar).
 *
 * The resource server declares how its paid route is called under
 * `PaymentRequired.extensions.bazaar`; the paying client echoes that object into
 * `PaymentPayload.extensions.bazaar`, which is what reaches /verify and /settle.
 * This module validates the echoed declaration the way the reference facilitator
 * does (spec invariants, then `info` against its own JSON Schema) and indexes it
 * once the payment has confirmed onchain. A bad declaration never fails the payment;
 * it is reported back to the resource server through the EXTENSION-RESPONSES header.
 */

export const BAZAAR_KEY = BAZAAR.key;
export const EXTENSION_RESPONSES_HEADER = 'EXTENSION-RESPONSES';

export type BazaarStatus = 'success' | 'processing' | 'rejected';

export interface BazaarExtensionResponse {
  status: BazaarStatus;
  rejectedReason?: string;
}

export type BazaarEvaluation =
  | { declared: false }
  | { declared: true; valid: true; resource: DiscoveredResource }
  | { declared: true; valid: false; rejectedReason: string }
  /** No verdict was reached (validator saturated); report `processing`, never `rejected` */
  | { declared: true; valid: false; deferred: true };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Longest `description` / `mimeType` we persist and republish on the public catalog. */
const MAX_DESCRIPTION_LENGTH = 1024;
const MAX_MIME_TYPE_LENGTH = 128;

function cap(value: string | undefined, limit: number): string | undefined {
  if (value === undefined) return undefined;
  return value.length > limit ? value.slice(0, limit) : value;
}

/**
 * Validate the bazaar declaration echoed in a payment payload, without side effects.
 * Returns `declared: false` when the payload carries no bazaar extension.
 */
export async function evaluateBazaarDeclaration(payment: NormalizedPayment, logger: Logger): Promise<BazaarEvaluation> {
  const declaration = payment.extensions?.[BAZAAR_KEY];
  if (declaration === undefined) {
    return { declared: false };
  }

  const reject = (rejectedReason: string): BazaarEvaluation => {
    logger.warn('Bazaar declaration rejected', { rejectedReason });
    return { declared: true, valid: false, rejectedReason };
  };

  if (payment.x402Version !== 2) {
    return reject('bazaar declarations are only accepted on x402Version 2 payloads');
  }
  if (!isPlainObject(declaration)) {
    return reject('extensions.bazaar must be an object');
  }
  if (!isPlainObject(declaration.info)) {
    return reject('extensions.bazaar.info is required');
  }
  if (!isPlainObject(declaration.schema)) {
    return reject('extensions.bazaar.schema is required');
  }

  // Cheap size bound before any schema work. The body limit alone is 100kb, which is far
  // more schema than a real declaration needs and far more than we want to hand to Ajv.
  let declarationBytes: number;
  try {
    declarationBytes = Buffer.byteLength(JSON.stringify(declaration), 'utf8');
  } catch {
    return reject('extensions.bazaar must be JSON-serializable');
  }
  if (declarationBytes > DISCOVERY_MAX_DECLARATION_BYTES) {
    return reject(`extensions.bazaar must be at most ${DISCOVERY_MAX_DECLARATION_BYTES} bytes, got ${declarationBytes}`);
  }

  // Protocol invariants: input.type, method / bodyType, MCP toolName + inputSchema
  const spec = validateDiscoveryExtensionSpec(declaration);
  if (!spec.valid) {
    return reject(`info failed spec validation: ${spec.errors?.join('; ')}`);
  }

  const info = declaration.info;
  const input = info.input as Record<string, unknown>;
  if (input.type === 'http' && typeof input.method !== 'string') {
    // The SDK's server extension fills this in at 402 time; a declaration without it cannot be called
    return reject('info.input.method is required for http resources');
  }
  if (info.output !== undefined && (!isPlainObject(info.output) || typeof info.output.type !== 'string')) {
    return reject('info.output.type is required when output is present');
  }

  // The catalogued URL is what agents will call, so loopback and IP-literal hosts are out
  const screened = screenResourceUrl(payment.resource?.url, DISCOVERY_ALLOW_PRIVATE_RESOURCE_URLS);
  if (!screened.ok) {
    return reject(screened.reason);
  }

  // `info` must satisfy the declaration's own schema; external $ref/$id are refused inside.
  // Both schema and info are attacker-controlled and Ajv compiles `pattern` to a bare
  // RegExp, so this runs in a worker under a hard timeout (see schemaGuard.ts).
  const schemaResult = await validateDeclarationSchema(declaration);
  if (!schemaResult.valid) {
    // A timeout and a saturated validator are both "no verdict reached", not findings about
    // the declaration: a slow match can equally mean a hostile regex or a starved CPU, and
    // we cannot tell which. Reporting `processing` costs nothing (the row is not indexed
    // and the payment is untouched) and avoids condemning an honest seller under load.
    if ('unavailable' in schemaResult) {
      logger.warn('Bazaar declaration deferred: schema validator unavailable');
      return { declared: true, valid: false, deferred: true };
    }
    if ('timedOut' in schemaResult) {
      logger.warn('Bazaar declaration deferred: schema validation timed out', { errors: schemaResult.errors });
      return { declared: true, valid: false, deferred: true };
    }
    return reject(`info failed schema validation: ${schemaResult.errors.join('; ')}`);
  }

  // `accepts` is catalogued from the advertised requirements; make sure they are well formed
  const req = payment.requirements;
  if (!/^\d+$/.test(req.amount)) {
    return reject('accepts.amount must be an atomic integer string');
  }
  if (typeof req.asset !== 'string' || typeof req.payTo !== 'string') {
    return reject('accepts.asset and accepts.payTo must be strings');
  }

  let resource: DiscoveredResource | null;
  try {
    // Validation already ran above; pass validate=false so the SDK does not log to console
    resource = extractDiscoveryInfo(payment.raw.paymentPayload, payment.raw.paymentRequirements, false);
  } catch (error: any) {
    return reject(`could not extract discovery info: ${error.message}`);
  }
  if (!resource) {
    return reject('could not extract discovery info');
  }

  // The screen above saw `resource.url`, but what gets stored is the SDK's canonical URL:
  // origin + the declaration's `routeTemplate`, which the SDK does not length-bound. Screen
  // the derived value too, so the catalog never holds a URL the screen has not seen.
  const derived = screenResourceUrl(resource.resourceUrl, DISCOVERY_ALLOW_PRIVATE_RESOURCE_URLS);
  if (!derived.ok) {
    return reject(`catalogued url (origin + routeTemplate) refused: ${derived.reason}`);
  }

  logger.info('Bazaar declaration accepted', {
    resource: resource.resourceUrl,
    type: resource.discoveryInfo.input.type,
  });
  return { declared: true, valid: true, resource };
}

export const REJECTED_CLAIMED_BY_OTHER = 'resource claimed by another merchant';

/**
 * Write an accepted declaration to the catalog. Only call this once the payer's
 * transfer has confirmed, so unpaid declarations never become discoverable.
 * Returns `claimed_by_other` when the (resource, toolName) key already belongs to a
 * different merchant; the caller reports that as a rejection.
 */
export async function indexBazaarResource(
  resource: DiscoveredResource,
  payment: NormalizedPayment,
  merchantAddress: Address,
  logger: Logger
): Promise<UpsertOutcome> {
  const type = resource.discoveryInfo.input.type;

  // The SDK sanitizes serviceName, tags and iconUrl but passes description and mimeType
  // through untouched, and every field here is republished on a public endpoint, so bound
  // the two it leaves alone.
  const description = cap(resource.description, MAX_DESCRIPTION_LENGTH);
  const mimeType = cap(resource.mimeType, MAX_MIME_TYPE_LENGTH);

  // `resource.extensions` is the buyer's whole `paymentPayload.extensions` map. Republish
  // only the declaration this catalog is about, not every other extension they attached.
  const bazaarExtension = isPlainObject(resource.extensions) ? resource.extensions[BAZAAR_KEY] : undefined;

  const metadata: DiscoveryMetadata = {
    ...(description !== undefined && { description }),
    ...(mimeType !== undefined && { mimeType }),
    ...(resource.serviceName !== undefined && { serviceName: resource.serviceName }),
    ...(resource.tags !== undefined && { tags: resource.tags }),
    ...(resource.iconUrl !== undefined && { iconUrl: resource.iconUrl }),
    ...(bazaarExtension !== undefined && { extensions: { [BAZAAR_KEY]: bazaarExtension } }),
  };

  const outcome = await upsertDiscoveryResource({
    resourceUrl: resource.resourceUrl,
    type,
    toolName: 'toolName' in resource ? resource.toolName : undefined,
    x402Version: resource.x402Version,
    requirement: payment.raw.paymentRequirements,
    metadata,
    merchantAddress,
    nonce: payment.authorization.nonce,
  });

  if (outcome === 'claimed_by_other') {
    logger.warn('Bazaar resource not catalogued', { resource: resource.resourceUrl, type, reason: REJECTED_CLAIMED_BY_OTHER });
  } else {
    logger.info('Bazaar resource catalogued', { resource: resource.resourceUrl, type, outcome });
  }
  return outcome;
}

/** Base64 JSON keyed by extension name, per spec section 7.2.1 */
export function encodeExtensionResponses(responses: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(responses), 'utf8').toString('base64');
}

/**
 * Attach the facilitator-to-server sidechannel for the bazaar extension.
 * Omitted entirely when the payload carried no declaration (absence carries no signal).
 */
export function setBazaarExtensionResponse(res: Response, response: BazaarExtensionResponse | undefined): void {
  if (!response) return;
  res.setHeader(EXTENSION_RESPONSES_HEADER, encodeExtensionResponses({ [BAZAAR_KEY]: response }));
}
