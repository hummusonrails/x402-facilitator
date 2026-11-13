import { declareDiscoveryExtension } from '@x402/extensions/bazaar';
import type { NormalizedPayment } from '../src/types.js';

export const FACILITATOR = '0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1'; // address of private key 0x01…01
export const PAYER = '0xe7D03950f92DbD90Ce626286DCCc8768dEE09ad1';
export const MERCHANT = '0xa4d50e386Fa77d3EE3D4F7e8246dE21F4828eeF4';
export const USDC_SEPOLIA = '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d';
export const RESOURCE_URL = 'https://api.example.com/analyze';
/** A loopback seller, as used in local development; refused by the resource-URL screen */
export const LOOPBACK_RESOURCE_URL = 'http://localhost:3100/analyze';

export const requirements = {
  scheme: 'exact',
  network: 'eip155:421614',
  amount: '250000',
  asset: USDC_SEPOLIA,
  payTo: FACILITATOR,
  maxTimeoutSeconds: 300,
  extra: { name: 'USD Coin', version: '2' },
};

/** A declaration the way the seller SDK emits it after method enrichment at 402 time */
export function validBazaarDeclaration(): Record<string, unknown> {
  const declared = declareDiscoveryExtension({
    input: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' },
    inputSchema: { properties: { address: { type: 'string' } }, required: ['address'] },
    output: { example: { ok: true } },
  }).bazaar as any;
  return {
    ...declared,
    info: { ...declared.info, input: { ...declared.info.input, method: 'GET' } },
  };
}

export function authorization(nonceByte = 'ab') {
  const now = Math.floor(Date.now() / 1000);
  return {
    from: PAYER,
    to: FACILITATOR,
    value: '250000',
    validAfter: String(now - 60),
    validBefore: String(now + 300),
    nonce: `0x${nonceByte.repeat(32)}`,
  };
}

/** Raw /verify or /settle request body */
export function facilitatorRequest(bazaar?: unknown, resourceUrl: string = RESOURCE_URL) {
  return {
    x402Version: 2,
    paymentPayload: {
      x402Version: 2,
      resource: { url: resourceUrl, description: 'test', mimeType: 'application/json' },
      accepted: requirements,
      payload: { signature: `0x${'11'.repeat(65)}`, authorization: authorization() },
      ...(bazaar !== undefined && { extensions: { bazaar } }),
    },
    paymentRequirements: requirements,
  };
}

/** NormalizedPayment as x402.ts would produce it for the request above */
export function normalizedPayment(bazaar?: unknown, resourceUrl: string = RESOURCE_URL): NormalizedPayment {
  const body = facilitatorRequest(bazaar, resourceUrl);
  const auth = body.paymentPayload.payload.authorization;
  return {
    x402Version: 2,
    accepted: { ...requirements, extra: requirements.extra },
    requirements: { ...requirements },
    authorization: {
      from: auth.from as `0x${string}`,
      to: auth.to as `0x${string}`,
      value: BigInt(auth.value),
      validAfter: BigInt(auth.validAfter),
      validBefore: BigInt(auth.validBefore),
      nonce: auth.nonce as `0x${string}`,
    },
    signature: body.paymentPayload.payload.signature as `0x${string}`,
    resource: body.paymentPayload.resource,
    extensions: (body.paymentPayload as any).extensions,
    raw: { paymentPayload: body.paymentPayload as any, paymentRequirements: requirements as any },
  };
}

export function decodeExtensionResponses(header: string | null): Record<string, any> | null {
  return header ? JSON.parse(Buffer.from(header, 'base64').toString('utf8')) : null;
}
