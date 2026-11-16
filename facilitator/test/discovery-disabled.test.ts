import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { MERCHANT, PAYER, decodeExtensionResponses, facilitatorRequest, validBazaarDeclaration } from './fixtures.js';

// DISCOVERY_ENABLED is left unset (test/setup.ts deletes it). Everything else is set up so
// that discovery would be fully active if it were on: a database, a verifying payment and
// a valid declaration. None of it may show.
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
vi.mock('../src/verify.js', () => ({
  verifyPayment: async () => ({ response: { isValid: true, payer: PAYER } }),
}));
const settlePayment = vi.fn(async () => ({ success: true, payer: PAYER, transaction: '0x01', network: 'eip155:421614' }));
vi.mock('../src/settle.js', () => ({ settlePayment: (...args: unknown[]) => settlePayment(...(args as [])) }));
const evaluateBazaarDeclaration = vi.fn();
vi.mock('../src/bazaar.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/bazaar.js')>()),
  evaluateBazaarDeclaration: (...args: unknown[]) => evaluateBazaarDeclaration(...args),
}));

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

async function post(path: string, body: unknown) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, header: res.headers.get('extension-responses'), body: await res.json() };
}

describe('with DISCOVERY_ENABLED unset', () => {
  it('does not advertise bazaar on /supported, even with a database', async () => {
    const supported = await (await fetch(`${base}/supported`)).json();
    expect(supported.extensions).toEqual([]);
  });

  it('does not evaluate a declaration on /verify or send EXTENSION-RESPONSES', async () => {
    const { status, header, body } = await post('/verify', facilitatorRequest(validBazaarDeclaration()));
    expect(status).toBe(200);
    expect(body).toMatchObject({ isValid: true, payer: PAYER });
    expect(decodeExtensionResponses(header)).toBeNull();
    expect(evaluateBazaarDeclaration).not.toHaveBeenCalled();
  });

  it('settles without evaluating the declaration or passing settle hooks', async () => {
    const { status, header, body } = await post('/settle', facilitatorRequest(validBazaarDeclaration()));
    expect(status).toBe(200);
    expect(body).toMatchObject({ success: true });
    expect(decodeExtensionResponses(header)).toBeNull();
    expect(evaluateBazaarDeclaration).not.toHaveBeenCalled();
    expect(settlePayment).toHaveBeenCalledTimes(1);
    expect(settlePayment.mock.calls[0]).toHaveLength(4);
    expect((settlePayment.mock.calls[0] as unknown[])[3]).toBeUndefined();
  });

  it('serves no /discovery/resources route', async () => {
    const res = await fetch(`${base}/discovery/resources`);
    expect(res.status).toBe(404);
  });
});
