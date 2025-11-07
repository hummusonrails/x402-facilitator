import type { Address } from 'viem';
import { z } from 'zod';
import {
  PaymentRequirementsSchema as SDKPaymentRequirementsSchema,
  PaymentPayloadSchema as SDKPaymentPayloadSchema,
  SupportedEVMNetworks,
  type PaymentRequirements as SDKPaymentRequirements,
  type PaymentPayload as SDKPaymentPayload,
} from 'x402/types';

// EIP-3009 Transfer with Authorization types
export interface EIP3009Authorization {
  from: Address;
  to: Address;
  value: string;
  validAfter: number;
  validBefore: number;
  nonce: `0x${string}`;
}

export interface EIP3009Signature {
  v: number;
  r: `0x${string}`;
  s: `0x${string}`;
}

// Payment payload - network is now dynamic
export interface PaymentPayload {
  x402Version?: number;
  scheme: string;
  network: string;
  payload: {
    from: string;
    to: string;
    value: string;
    validAfter: number;
    validBefore: number;
    nonce: string;
    v: number;
    r: string;
    s: string;
  };
}

// Payment requirements
export interface PaymentRequirements {
  scheme: string;
  network: string;
  token: string;
  amount: string;
  recipient: string; // In fee model, this is the facilitator address
  description: string;
  maxTimeoutSeconds: number;
  merchantAddress?: string; // Optional: final destination merchant (for fee model)
}

// Request/Response types
export interface VerifyRequest {
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
}

export interface VerifyResponse {
  valid: boolean;
  invalidReason?: string;
}

export interface SettleRequest {
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
}

export interface SettleResponse {
  success: boolean;
  txHash?: string;
  meta?: {
    journalId?: string;
    grossAmount?: string;
    feeAmount?: string;
    merchantNet?: string;
    forwardTxHash?: string;
    incomingTxHash?: string;
    outgoingTxHash?: string;
    blockNumber?: number;
    status?: string;
  };
  transactionHash?: string;
  incomingTransactionHash?: string;
  outgoingTransactionHash?: string;
  blockNumber?: number;
  status?: 'confirmed' | 'pending';
  merchantAddress?: string;
  error?: string;
  feeBreakdown?: {
    merchantAmount: string;
    serviceFee: string;
    gasFee: string;
    totalAmount: string;
  };
}

export interface SupportedPaymentKind {
  x402Version: number;
  scheme: 'exact';
  network: string;
}

export interface SupportedResponse {
  kinds: SupportedPaymentKind[];
}

export interface HealthResponse {
  status: 'ok' | 'error';
  network: string;
  chainId: number;
  timestamp: number;
}

// Zod schemas for validation
export const PaymentPayloadSchema = z.object({
  x402Version: z.number().optional(),
  scheme: z.string(),
  network: z.string(),
  payload: z.object({
    from: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    to: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    value: z.string(),
    validAfter: z.number(),
    validBefore: z.number(),
    nonce: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    v: z.number(),
    r: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    s: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  }),
});

export const PaymentRequirementsSchema = z.object({
  scheme: z.string(),
  network: z.string(),
  token: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amount: z.string(),
  recipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  description: z.string(),
  maxTimeoutSeconds: z.number(),
  merchantAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
});

export const VerifyRequestSchema = z.object({
  paymentPayload: PaymentPayloadSchema,
  paymentRequirements: PaymentRequirementsSchema,
});

export const SettleRequestSchema = z.object({
  paymentPayload: PaymentPayloadSchema,
  paymentRequirements: PaymentRequirementsSchema,
});

export { SDKPaymentRequirementsSchema, SDKPaymentPayloadSchema, SupportedEVMNetworks };

export interface SDKVerifyResponse {
  valid: boolean;
  reason: string | null;
  meta?: {
    journalId?: string;
    facilitatorRecipient?: string;
    feeBreakdown?: {
      merchantAmount: string;
      serviceFee: string;
      gasFee: string;
      totalAmount: string;
    };
  };
}

export interface SDKSettleResponse {
  success: boolean;
  txHash?: string;
  meta?: {
    journalId?: string;
    grossAmount?: string;
    feeAmount?: string;
    merchantNet?: string;
    forwardTxHash?: string;
    status?: string;
    incomingTxHash?: string;
    outgoingTxHash?: string;
    blockNumber?: number;
  };
}

export interface RequirementsRequest {
  amount?: string;
  memo?: string;
  currency?: string;
  extra?: {
    merchantAddress?: string;
    [key: string]: any;
  };
}

// X402 PaymentRequirements format (for accepts array)
export interface PaymentRequirementsAccepts {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  asset: string;
  payTo: string;
  resource: string;
  description: string;
  mimeType: string; // Required per x402 validation
  outputSchema?: object;
  maxTimeoutSeconds: number;
  extra?: {
    [key: string]: any;
  };
}

// X402 PaymentRequirementsResponse format
export interface PaymentRequirementsResponse {
  x402Version: number;
  error: string;
  accepts: PaymentRequirementsAccepts[];
}

// Zod schema for PaymentRequirementsResponse validation
export const PaymentRequirementsAcceptsSchema = z.object({
  scheme: z.string(),
  network: z.enum(['arbitrum', 'arbitrum-sepolia', 'base', 'base-sepolia', 'avalanche', 'avalanche-fuji', 'ethereum', 'ethereum-sepolia']),
  maxAmountRequired: z.string(),
  asset: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  payTo: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  resource: z.string().url(),
  description: z.string(),
  mimeType: z.string(),
  outputSchema: z.object({}).passthrough().optional(),
  maxTimeoutSeconds: z.number(),
  extra: z.object({}).passthrough().optional(),
});

export const PaymentRequirementsResponseSchema = z.object({
  x402Version: z.literal(1),
  error: z.string(),
  accepts: z.array(PaymentRequirementsAcceptsSchema),
});

export type { SDKPaymentRequirements, SDKPaymentPayload };

export const SDKVerifyRequestSchema = z.object({
  network: z.string(),
  token: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  recipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amount: z.string(),
  nonce: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  deadline: z.number(),
  memo: z.string().optional(),
  extra: z.object({
    merchantAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    feeMode: z.string().optional(),
  }).passthrough().optional(),
  permit: z.object({
    owner: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    spender: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    value: z.string(),
    deadline: z.number(),
    sig: z.string(),
  }),
});

export interface SDKVerifyRequest {
  network: string;
  token: string;
  recipient: string;
  amount: string;
  nonce: string;
  deadline: number;
  memo?: string;
  extra?: {
    merchantAddress: string;
    feeMode?: string;
    [key: string]: any;
  };
  permit: {
    owner: string;
    spender: string;
    value: string;
    deadline: number;
    sig: string;
  };
}
