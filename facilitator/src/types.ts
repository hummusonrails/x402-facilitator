import type { Address } from 'viem';
import { z } from 'zod';

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
  transactionHash?: string; // Final transaction (to merchant)
  incomingTransactionHash?: string; // User to facilitator
  outgoingTransactionHash?: string; // Facilitator to merchant
  blockNumber?: number;
  status?: 'confirmed' | 'pending';
  merchantAddress?: string; // Final destination merchant (for reconciliation)
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
  facilitatorAddress: string;
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
