import type { Address, Hex } from 'viem';
import { z } from 'zod';

// Wire types for the facilitator API come straight from @x402/core so they track the spec.
export type {
  VerifyResponse,
  SettleResponse,
  SupportedKind,
  SupportedResponse,
  PaymentRequired,
  PaymentRequirements,
  PaymentPayload,
  ResourceInfo,
  PaymentRequirementsV1,
} from '@x402/core/types';
import type { PaymentPayload, PaymentRequirements, PaymentRequirementsV1 as PaymentRequirementsV1Type, ResourceInfo as ResourceInfoType } from '@x402/core/types';

// EIP-3009 authorization as carried in an exact EVM payload
export interface EIP3009Authorization {
  from: Address;
  to: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
}

// Version-independent view of a verify/settle request. v1 and v2 requests are
// both normalized into this shape (CAIP-2 network, `amount` rather than
// `maxAmountRequired`) before any checks run.
export interface NormalizedRequirements {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
}

export interface NormalizedPayment {
  x402Version: 1 | 2;
  // What the client says it accepted (v2 `accepted`, or v1 top-level scheme/network)
  accepted: { scheme: string; network: string; amount?: string; asset?: string; payTo?: string; extra: Record<string, unknown> };
  requirements: NormalizedRequirements;
  authorization: EIP3009Authorization;
  signature: Hex;
  // v2 only: resource info and extension echoes carried by the client (e.g. `bazaar`)
  resource?: ResourceInfoType;
  extensions?: Record<string, unknown>;
  // The validated wire objects, kept for extension processing that needs the full shape
  raw: {
    paymentPayload: PaymentPayload;
    paymentRequirements: PaymentRequirements | PaymentRequirementsV1Type;
  };
}

// Exact EVM payload using the eip3009 asset transfer method
const uintString = z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).transform((v) => BigInt(v));

export const ExactEvmEip3009PayloadSchema = z.object({
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  authorization: z.object({
    from: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    to: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    value: uintString,
    validAfter: uintString,
    validBefore: uintString,
    nonce: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  }),
});

export interface HealthResponse {
  status: 'ok' | 'error';
  network: string;
  chainId: number;
  timestamp: number;
}

// Body accepted by the /requirements helper endpoint
export interface RequirementsRequest {
  amount?: string;
  memo?: string;
  x402Version?: number;
  version?: number;
  resource?: {
    url?: string;
    description?: string;
    mimeType?: string;
  };
  extra?: {
    merchantAddress?: string;
    resource?: string;
    description?: string;
    mimeType?: string;
    outputSchema?: object;
    [key: string]: any;
  };
}
