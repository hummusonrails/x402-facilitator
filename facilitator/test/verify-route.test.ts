import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { PAYER, decodeExtensionResponses, facilitatorRequest, validBazaarDeclaration } from './fixtures.js';
import { shutdownSchemaGuard } from '../src/schemaGuard.js';

// Hoisted above the imports: config.ts reads DISCOVERY_ENABLED when it is first loaded
vi.hoisted(() => {
  process.env.DISCOVERY_ENABLED = 'true';
});

// The route is exercised over real HTTP; chain and database access are stubbed out.
vi.mock('../src/clients.js', () => ({
  publicClient: {},
  walletClient: {},
  facilitatorAccount: { address: '0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1' },
  USDC_ABI: [],
  splitEcdsaSignature: () => null,
}));
// Controllable per test: /supported only advertises bazaar when there is an index to write to
const database = { configured: false };
vi.mock('../src/db.js', () => ({ isDatabaseConfigured: () => database.configured, pool: {} }));
vi.mock('../src/merchantStore.js', () => ({ getAllMerchants: async () => [], getMerchantByAddress: async () => null }));
// Controllable per test: /verify only evaluates declarations once the payment verifies
const verifyResult: { isValid: boolean; invalidReason?: string; payer: string } = { isValid: true, payer: PAYER };
vi.mock('../src/verify.js', () => ({
  verifyPayment: async () => ({ response: { ...verifyResult } }),
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
  await shutdownSchemaGuard();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  database.configured = false;
  verifyResult.isValid = true;
  delete verifyResult.invalidReason;
});

async function verify(body: unknown) {
  const res = await fetch(`${base}/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, header: decodeExtensionResponses(res.headers.get('extension-responses')), body: await res.json() };
}

describe('GET /supported', () => {
  it('advertises the bazaar extension when a database backs the index', async () => {
    database.configured = true;
    const supported = await (await fetch(`${base}/supported`)).json();
    expect(supported.extensions).toEqual(['bazaar']);
  });

  it('does not advertise bazaar without a database, since settle could only reject the declaration', async () => {
    const supported = await (await fetch(`${base}/supported`)).json();
    expect(supported.extensions).toEqual([]);
  });
});

describe('POST /verify with a bazaar declaration', () => {
  it('returns 200 and a rejected EXTENSION-RESPONSES header for a malformed declaration, without touching the payment result', async () => {
    const { status, header, body } = await verify(facilitatorRequest({ info: { input: { type: 'grpc' } }, schema: { type: 'object' } }));
    expect(status).toBe(200);
    expect(body).toMatchObject({ isValid: true, payer: PAYER });
    expect(header).toEqual({
      bazaar: { status: 'rejected', rejectedReason: expect.stringContaining('input.type must be "http" or "mcp"') },
    });
  });

  it('does no declaration work at all when the payment does not verify', async () => {
    verifyResult.isValid = false;
    verifyResult.invalidReason = 'invalid_exact_evm_signature';

    const { status, header, body } = await verify(facilitatorRequest(validBazaarDeclaration()));
    expect(status).toBe(200);
    expect(body).toMatchObject({ isValid: false, invalidReason: 'invalid_exact_evm_signature' });
    // No header means the schema step never ran: an unsigned payload buys no CPU here
    expect(header).toBeNull();
  });

  it('reports processing for a valid declaration (indexing waits for settle)', async () => {
    const { status, header } = await verify(facilitatorRequest(validBazaarDeclaration()));
    expect(status).toBe(200);
    expect(header).toEqual({ bazaar: { status: 'processing' } });
  });

  it('sends no header when the payload carries no declaration', async () => {
    const { status, header } = await verify(facilitatorRequest(undefined));
    expect(status).toBe(200);
    expect(header).toBeNull();
  });
});

describe('GET /discovery/resources', () => {
  it('validates query parameters', async () => {
    expect((await fetch(`${base}/discovery/resources?type=grpc`)).status).toBe(400);
    expect((await fetch(`${base}/discovery/resources?limit=0`)).status).toBe(400);
    expect((await fetch(`${base}/discovery/resources?limit=101`)).status).toBe(400);
    expect((await fetch(`${base}/discovery/resources?offset=-1`)).status).toBe(400);
    // Past Postgres' bigint range; must be a 400, not a driver error surfacing as a 500
    expect((await fetch(`${base}/discovery/resources?offset=99999999999999999999`)).status).toBe(400);
  });

  it('returns 503 when no database is configured', async () => {
    expect((await fetch(`${base}/discovery/resources`)).status).toBe(503);
  });
});
