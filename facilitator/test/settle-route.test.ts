import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { MERCHANT, PAYER, decodeExtensionResponses, facilitatorRequest, validBazaarDeclaration } from './fixtures.js';
import * as Errors from '../src/errors.js';

// Hoisted above the imports: config.ts reads these when it is first loaded
vi.hoisted(() => {
  process.env.DISCOVERY_ENABLED = 'true';
  process.env.DISCOVERY_SCHEMA_TIMEOUT_MS = '50';
});

// The route runs over real HTTP. Settlement and the declaration verdict are both
// controllable per test, so their relative timing can be arranged.
vi.mock('../src/clients.js', () => ({
  publicClient: {},
  walletClient: {},
  facilitatorAccount: { address: '0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1' },
  USDC_ABI: [],
  splitEcdsaSignature: () => null,
}));
vi.mock('../src/db.js', () => ({ isDatabaseConfigured: () => true, pool: {} }));
vi.mock('../src/merchantStore.js', () => ({ getAllMerchants: async () => [], getMerchantByAddress: async () => null }));
vi.mock('../src/auth.js', () => ({
  authenticateMerchant: (req: any, _res: any, next: () => void) => {
    req.merchant = { address: MERCHANT };
    next();
  },
  authenticateAdmin: (_req: any, _res: any, next: () => void) => next(),
}));

type Hooks = { onIncomingConfirmed?: (context: any) => Promise<void> } | undefined;
const settlePayment = vi.fn();
vi.mock('../src/settle.js', () => ({ settlePayment: (...args: unknown[]) => settlePayment(...args) }));
const evaluateBazaarDeclaration = vi.fn();
const indexBazaarResource = vi.fn();
vi.mock('../src/bazaar.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/bazaar.js')>()),
  evaluateBazaarDeclaration: (...args: unknown[]) => evaluateBazaarDeclaration(...args),
  indexBazaarResource: (...args: unknown[]) => indexBazaarResource(...args),
}));

const VALID = { declared: true, valid: true, resource: { resourceUrl: 'https://api.example.com/analyze' } };
const SUCCESS = { success: true, payer: PAYER, transaction: '0x01', network: 'eip155:421614' };

/** A promise plus its resolver, for verdicts that arrive when the test says so. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Settlement that confirms, then runs the hook the way settle.ts does. */
async function confirmingSettle(_p: unknown, _m: unknown, _l: unknown, hooks: Hooks) {
  await hooks?.onIncomingConfirmed?.({ nonce: '0x', incomingHash: '0x01', merchantAddress: MERCHANT });
  return SUCCESS;
}

let server: Server;
let base: string;

beforeAll(async () => {
  const { app } = await import('../src/server.js');
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  settlePayment.mockReset();
  evaluateBazaarDeclaration.mockReset();
  indexBazaarResource.mockReset();
  indexBazaarResource.mockResolvedValue('indexed');
});

async function settle(body: unknown) {
  const res = await fetch(`${base}/settle`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, header: decodeExtensionResponses(res.headers.get('extension-responses')), body: await res.json() };
}

describe('POST /settle with a bazaar declaration', () => {
  it('starts settlement while the declaration is still being validated', async () => {
    const verdict = deferred<unknown>();
    evaluateBazaarDeclaration.mockReturnValue(verdict.promise);
    let verdictInWhenSettleStarted: boolean | undefined;
    let verdictIn = false;
    verdict.promise.then(() => {
      verdictIn = true;
    });
    settlePayment.mockImplementation(async (...args: [unknown, unknown, unknown, Hooks]) => {
      verdictInWhenSettleStarted = verdictIn;
      // The verdict lands while the payer's transfer is confirming, inside the hook's deadline
      setTimeout(() => verdict.resolve(VALID), 10);
      return confirmingSettle(...args);
    });

    const { status, header, body } = await settle(facilitatorRequest(validBazaarDeclaration()));
    expect(status).toBe(200);
    expect(body).toMatchObject({ success: true });
    expect(evaluateBazaarDeclaration).toHaveBeenCalledTimes(1);
    expect(verdictInWhenSettleStarted).toBe(false);
    expect(indexBazaarResource).toHaveBeenCalledTimes(1);
    expect(header).toEqual({ bazaar: { status: 'success' } });
  });

  it('reports the rejection when the verdict is in by the time the payment confirms', async () => {
    evaluateBazaarDeclaration.mockResolvedValue({ declared: true, valid: false, rejectedReason: 'input.type must be "http" or "mcp"' });
    settlePayment.mockImplementation(confirmingSettle);

    const { status, header } = await settle(facilitatorRequest(validBazaarDeclaration()));
    expect(status).toBe(200);
    expect(header).toEqual({ bazaar: { status: 'rejected', rejectedReason: 'input.type must be "http" or "mcp"' } });
    expect(indexBazaarResource).not.toHaveBeenCalled();
  });

  it('stops waiting at the deadline, reports processing and indexes nothing', async () => {
    evaluateBazaarDeclaration.mockReturnValue(new Promise(() => {}));
    settlePayment.mockImplementation(confirmingSettle);

    const started = Date.now();
    const { status, header, body } = await settle(facilitatorRequest(validBazaarDeclaration()));
    expect(status).toBe(200);
    expect(body).toMatchObject({ success: true });
    expect(header).toEqual({ bazaar: { status: 'processing' } });
    expect(indexBazaarResource).not.toHaveBeenCalled();
    // DISCOVERY_SCHEMA_TIMEOUT_MS is 50 here; well under a second, nowhere near a queue's worth
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('survives an evaluation that rejects before the hook awaits it', async () => {
    evaluateBazaarDeclaration.mockRejectedValue(new Error('worker crashed'));
    settlePayment.mockImplementation(async (...args: [unknown, unknown, unknown, Hooks]) => {
      // Long enough for an unhandled rejection to be reported if nothing had caught it
      await new Promise((resolve) => setTimeout(resolve, 30));
      return confirmingSettle(...args);
    });

    const { status, header, body } = await settle(facilitatorRequest(validBazaarDeclaration()));
    expect(status).toBe(200);
    expect(body).toMatchObject({ success: true });
    expect(header).toEqual({ bazaar: { status: 'processing' } });
  });

  it('gives no verdict when the payment fails, even for an invalid declaration', async () => {
    evaluateBazaarDeclaration.mockResolvedValue({ declared: true, valid: false, rejectedReason: 'bad' });
    settlePayment.mockResolvedValue({ success: false, errorReason: Errors.ErrInvalidSignature, payer: PAYER, transaction: '', network: 'eip155:421614' });

    const { header, body } = await settle(facilitatorRequest(validBazaarDeclaration()));
    expect(body).toMatchObject({ success: false });
    expect(header).toBeNull();
  });

  it('reports processing while the payment is still pending', async () => {
    evaluateBazaarDeclaration.mockResolvedValue({ declared: true, valid: false, rejectedReason: 'bad' });
    settlePayment.mockResolvedValue({ success: false, errorReason: Errors.ErrSettlementPending, payer: PAYER, transaction: '0x01', network: 'eip155:421614' });

    const { header } = await settle(facilitatorRequest(validBazaarDeclaration()));
    expect(header).toEqual({ bazaar: { status: 'processing' } });
  });

  it('passes no hooks and does no declaration work when the payload carries no declaration', async () => {
    settlePayment.mockResolvedValue(SUCCESS);

    const { header } = await settle(facilitatorRequest(undefined));
    expect(header).toBeNull();
    expect(evaluateBazaarDeclaration).not.toHaveBeenCalled();
    expect(settlePayment.mock.calls[0][3]).toBeUndefined();
  });
});
