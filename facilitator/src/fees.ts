import { SERVICE_FEE_BPS, GAS_FEE_USDC } from './config.js';

export interface FeeSplit {
  totalAmount: bigint;
  merchantAmount: bigint;
  serviceFee: bigint;
  gasFee: bigint;
  facilitatorFee: bigint;
}

/**
 * Split a gross payment into the merchant share and the facilitator fee.
 * total = merchant + merchant * bps / 10000 + gas. The service fee is taken as
 * the residual so the three parts always sum to exactly the gross amount.
 * Returns null when the amount does not cover the fixed gas fee.
 */
export function computeFeeSplit(totalAmount: bigint): FeeSplit | null {
  if (totalAmount < GAS_FEE_USDC) {
    return null;
  }
  const totalMinusGas = totalAmount - GAS_FEE_USDC;
  const merchantAmount = (totalMinusGas * 10000n) / (10000n + BigInt(SERVICE_FEE_BPS));
  const serviceFee = totalMinusGas - merchantAmount;
  return {
    totalAmount,
    merchantAmount,
    serviceFee,
    gasFee: GAS_FEE_USDC,
    facilitatorFee: serviceFee + GAS_FEE_USDC,
  };
}
