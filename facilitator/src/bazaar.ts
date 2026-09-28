import {
  BAZAAR,
  extractDiscoveryInfo,
  validateDiscoveryExtension,
  validateDiscoveryExtensionSpec,
  type DiscoveredResource,
  type DiscoveryExtension,
} from '@x402/extensions/bazaar';
import type { Address } from 'viem';
import type { Response } from 'express';
import type { NormalizedPayment } from './types.js';
import { upsertDiscoveryResource, type DiscoveryMetadata } from './discoveryStore.js';
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
  | { declared: true; valid: false; rejectedReason: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validate the bazaar declaration echoed in a payment payload, without side effects.
 * Returns `declared: false` when the payload carries no bazaar extension.
 */
export function evaluateBazaarDeclaration(payment: NormalizedPayment, logger: Logger): BazaarEvaluation {
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

  // `info` must satisfy the declaration's own schema; external $ref/$id are refused inside
  const schemaResult = validateDiscoveryExtension(declaration as unknown as DiscoveryExtension);
  if (!schemaResult.valid) {
    return reject(`info failed schema validation: ${schemaResult.errors?.join('; ')}`);
  }

  const url = payment.resource?.url;
  if (typeof url !== 'string' || !isAbsoluteHttpUrl(url)) {
    return reject('resource.url must be an absolute http(s) URL');
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

  logger.info('Bazaar declaration accepted', {
    resource: resource.resourceUrl,
    type: resource.discoveryInfo.input.type,
  });
  return { declared: true, valid: true, resource };
}

/**
 * Write an accepted declaration to the catalog. Only call this once the payer's
 * transfer has confirmed, so unpaid declarations never become discoverable.
 */
export async function indexBazaarResource(
  resource: DiscoveredResource,
  payment: NormalizedPayment,
  merchantAddress: Address,
  logger: Logger
): Promise<void> {
  const type = resource.discoveryInfo.input.type;
  const metadata: DiscoveryMetadata = {
    ...(resource.description !== undefined && { description: resource.description }),
    ...(resource.mimeType !== undefined && { mimeType: resource.mimeType }),
    ...(resource.serviceName !== undefined && { serviceName: resource.serviceName }),
    ...(resource.tags !== undefined && { tags: resource.tags }),
    ...(resource.iconUrl !== undefined && { iconUrl: resource.iconUrl }),
    ...('method' in resource && resource.method !== undefined && { method: resource.method }),
    ...('routeTemplate' in resource && resource.routeTemplate !== undefined && { routeTemplate: resource.routeTemplate }),
    ...(resource.extensions !== undefined && { extensions: resource.extensions }),
  };

  const outcome = await upsertDiscoveryResource({
    resourceUrl: resource.resourceUrl,
    type,
    toolName: 'toolName' in resource ? resource.toolName : undefined,
    x402Version: resource.x402Version,
    accepts: [payment.raw.paymentRequirements],
    metadata,
    merchantAddress,
    payTo: payment.requirements.payTo,
    scheme: payment.requirements.scheme,
    network: payment.requirements.network,
    nonce: payment.authorization.nonce,
  });

  logger.info('Bazaar resource catalogued', { resource: resource.resourceUrl, type, outcome });
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
