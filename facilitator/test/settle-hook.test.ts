import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeAbiParameters, keccak256, pad, toHex } from 'viem';
import { FACILITATOR, MERCHANT, PAYER, USDC_SEPOLIA, normalizedPayment } from './fixtures.js';

// Everything that touches the chain or the database is replaced; only settle.ts runs for real.
const writeContract = vi.fn();
const waitForTransactionReceipt = vi.fn();

vi.mock('../src/clients.js', () => ({
  publicClient: { waitForTransactionReceipt: (...args: unknown[]) => waitForTransactionReceipt(...args) },
  walletClient: { writeContract: (...args: unknown[]) => writeContract(...args) },
  facilitatorAccount: { address: FACILITATOR },
  USDC_ABI: [],
  splitEcdsaSignature: () => ({ v: 27, r: '0x01', s: '0x02' }),
}));
vi.mock('../src/db.js', () => ({ isDatabaseConfigured: () => false }));
vi.mock('../src/merchantStore.js', () => ({
  getMerchantByAddress: async () => ({ address: MERCHANT, name: 'm', enabled: true, approved: true, apiKeyHash: 'x' }),
}));
vi.mock('../src/nonceStore.js', () => ({
  createIfAbsent: async () => 'created',
  getPayment: async () => null,
  setStatus: async () => undefined,
  logPaymentEvent: async () => undefined,
}));
vi.mock('../src/verify.js', async () => {
  const { computeFeeSplit } = await import('../src/fees.js');
  return {
    verifyPayment: async () => ({ response: { isValid: true, payer: PAYER }, fees: computeFeeSplit(250000n) }),
  };
});

const { settlePayment } = await import('../src/settle.js');
const { createLogger } = await import('../src/logging.js');
const logger = createLogger({ context: 'test' });

const TRANSFER_TOPIC = keccak256(toHex('Transfer(address,address,uint256)'));
const INCOMING = `0x${'aa'.repeat(32)}` as const;
const OUTGOING = `0x${'bb'.repeat(32)}` as const;

function successReceipt(hash: string) {
  return {
    status: 'success',
    blockNumber: 1n,
    logs: [
      {
        address: USDC_SEPOLIA,
        topics: [TRANSFER_TOPIC, pad(PAYER as `0x${string}`), pad(FACILITATOR as `0x${string}`)],
        data: encodeAbiParameters([{ type: 'uint256' }], [250000n]),
        blockNumber: 1n,
        transactionHash: hash,
        logIndex: 0,
        transactionIndex: 0,
        blockHash: `0x${'cc'.repeat(32)}`,
        removed: false,
      },
    ],
  };
}

beforeEach(() => {
  writeContract.mockReset();
  waitForTransactionReceipt.mockReset();
  writeContract.mockResolvedValueOnce(INCOMING).mockResolvedValueOnce(OUTGOING);
  waitForTransactionReceipt.mockImplementation(async ({ hash }: { hash: string }) => successReceipt(hash));
});

describe('settlePayment hooks', () => {
  it('runs onIncomingConfirmed after the incoming transfer confirms, with the settlement context', async () => {
    const hook = vi.fn(async () => undefined);
    const payment = normalizedPayment(undefined);
    payment.authorization.nonce = `0x${'01'.repeat(32)}`;

    const result = await settlePayment(payment, MERCHANT, logger, { onIncomingConfirmed: hook });

    expect(result.success).toBe(true);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledWith({ nonce: payment.authorization.nonce, incomingHash: INCOMING, merchantAddress: MERCHANT });
    // The hook ran before the merchant forward was submitted
    expect(hook.mock.invocationCallOrder[0]).toBeLessThan(writeContract.mock.invocationCallOrder[1]);
  });

  it('does not fail the settlement when the hook throws', async () => {
    const payment = normalizedPayment(undefined);
    payment.authorization.nonce = `0x${'02'.repeat(32)}`;

    const result = await settlePayment(payment, MERCHANT, logger, {
      onIncomingConfirmed: async () => {
        throw new Error('index write failed');
      },
    });

    expect(result.success).toBe(true);
    expect(result.transaction).toBe(INCOMING);
    expect(result.extra?.forward).toEqual({ status: 'complete', transaction: OUTGOING });
    expect(writeContract).toHaveBeenCalledTimes(2);
  });

  it('does not run the hook when the incoming transfer has not confirmed', async () => {
    const hook = vi.fn(async () => undefined);
    const payment = normalizedPayment(undefined);
    payment.authorization.nonce = `0x${'03'.repeat(32)}`;
    waitForTransactionReceipt.mockReset();
    waitForTransactionReceipt.mockRejectedValue(new Error('timed out'));

    const result = await settlePayment(payment, MERCHANT, logger, { onIncomingConfirmed: hook });

    expect(result.success).toBe(false);
    expect(result.errorReason).toBe('settlement_pending');
    expect(hook).not.toHaveBeenCalled();
  });

  it('does not run the hook when the receipt lacks the expected Transfer event', async () => {
    const hook = vi.fn(async () => undefined);
    const payment = normalizedPayment(undefined);
    payment.authorization.nonce = `0x${'04'.repeat(32)}`;
    waitForTransactionReceipt.mockReset();
    waitForTransactionReceipt.mockResolvedValue({ status: 'success', blockNumber: 1n, logs: [] });

    const result = await settlePayment(payment, MERCHANT, logger, { onIncomingConfirmed: hook });

    expect(result.success).toBe(false);
    expect(result.errorReason).toBe('invalid_exact_evm_transfer_event_mismatch');
    expect(hook).not.toHaveBeenCalled();
  });
});
