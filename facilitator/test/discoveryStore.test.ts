import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Ownership is the whole defense against one merchant rewriting another's price and
 * payTo, and it lives entirely in the `ON CONFLICT ... WHERE` clause and the
 * `RETURNING (xmax = 0)` trick. Neither survives being mocked, so these run against a
 * real Postgres. Set TEST_DATABASE_URL to enable them; without it they skip.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

describeDb('upsertDiscoveryResource ownership', () => {
  // discoveryStore imports the pool at module load, so the URL has to be set first
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  const storeModule = import('../src/discoveryStore.js');
  const dbModule = import('../src/db.js');

  const MERCHANT_A = '0xa4d50e386Fa77d3EE3D4F7e8246dE21F4828eeF4' as const;
  // Same address as A, different casing: equality rests on decode(substr($7, 3), 'hex')
  const MERCHANT_A_LOWER = MERCHANT_A.toLowerCase() as `0x${string}`;
  const MERCHANT_B = '0xe7D03950f92DbD90Ce626286DCCc8768dEE09ad1' as const;

  const RESOURCE = 'https://api.example.com/analyze';

  function requirement(amount: string, payTo: string) {
    return { scheme: 'exact', network: 'eip155:421614', amount, asset: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', payTo };
  }

  function upsertArgs(merchantAddress: `0x${string}`, amount: string, payTo: string, nonce: string) {
    return {
      resourceUrl: RESOURCE,
      type: 'http' as const,
      toolName: undefined,
      x402Version: 2,
      requirement: requirement(amount, payTo),
      metadata: { description: `priced at ${amount}` },
      merchantAddress,
      nonce,
    };
  }

  async function row() {
    const { pool } = await dbModule;
    const { rows } = await pool.query(
      `SELECT accepts, metadata, settle_count, '0x' || encode(merchant_address, 'hex') AS merchant
       FROM discovery_resources WHERE resource_url = $1 AND tool_name = ''`,
      [RESOURCE]
    );
    return rows[0];
  }

  beforeEach(async () => {
    const { pool } = await dbModule;
    const schema = readFileSync(
      fileURLToPath(new URL('../migrations/006_discovery_resources.sql', import.meta.url)),
      'utf8'
    );
    await pool.query(schema);
    await pool.query('TRUNCATE discovery_resources');
  });

  afterAll(async () => {
    const { closePool } = await dbModule;
    await closePool();
  });

  it('inserts a new resource for the first merchant that settles it', async () => {
    const { upsertDiscoveryResource } = await storeModule;
    const outcome = await upsertDiscoveryResource(upsertArgs(MERCHANT_A, '250000', MERCHANT_A, '0xaa'));

    expect(outcome).toBe('inserted');
    const stored = await row();
    expect(stored.settle_count).toBe(1);
    expect(stored.accepts[0].amount).toBe('250000');
    expect(stored.merchant.toLowerCase()).toBe(MERCHANT_A_LOWER);
  });

  it('lets the owning merchant refresh the row and ticks settle_count', async () => {
    const { upsertDiscoveryResource } = await storeModule;
    await upsertDiscoveryResource(upsertArgs(MERCHANT_A, '250000', MERCHANT_A, '0xaa'));
    const outcome = await upsertDiscoveryResource(upsertArgs(MERCHANT_A, '500000', MERCHANT_A, '0xbb'));

    expect(outcome).toBe('updated');
    const stored = await row();
    expect(stored.settle_count).toBe(2);
    // accepts is replaced, not accumulated, so superseded terms never stay discoverable
    expect(stored.accepts).toHaveLength(1);
    expect(stored.accepts[0].amount).toBe('500000');
  });

  it('treats a checksummed and a lowercased owner address as the same merchant', async () => {
    const { upsertDiscoveryResource } = await storeModule;
    await upsertDiscoveryResource(upsertArgs(MERCHANT_A, '250000', MERCHANT_A, '0xaa'));
    const outcome = await upsertDiscoveryResource(upsertArgs(MERCHANT_A_LOWER, '300000', MERCHANT_A, '0xcc'));

    expect(outcome).toBe('updated');
    expect((await row()).settle_count).toBe(2);
  });

  it('refuses a foreign merchant and changes nothing', async () => {
    const { upsertDiscoveryResource } = await storeModule;
    await upsertDiscoveryResource(upsertArgs(MERCHANT_A, '250000', MERCHANT_A, '0xaa'));

    const outcome = await upsertDiscoveryResource(upsertArgs(MERCHANT_B, '1', MERCHANT_B, '0xdd'));

    expect(outcome).toBe('claimed_by_other');
    const stored = await row();
    // Price, payTo, metadata, owner and the counter all survive the attempted takeover
    expect(stored.accepts[0].amount).toBe('250000');
    expect(stored.accepts[0].payTo).toBe(MERCHANT_A);
    expect(stored.metadata.description).toBe('priced at 250000');
    expect(stored.merchant.toLowerCase()).toBe(MERCHANT_A_LOWER);
    expect(stored.settle_count).toBe(1);
  });

  it('keys MCP entries per tool, so one endpoint can serve several tools', async () => {
    const { upsertDiscoveryResource, listDiscoveryResources } = await storeModule;
    const mcp = (toolName: string, nonce: string) => ({
      ...upsertArgs(MERCHANT_A, '250000', MERCHANT_A, nonce),
      type: 'mcp' as const,
      toolName,
    });

    expect(await upsertDiscoveryResource(mcp('analyze', '0x01'))).toBe('inserted');
    expect(await upsertDiscoveryResource(mcp('summarize', '0x02'))).toBe('inserted');

    const { total } = await listDiscoveryResources({ type: 'mcp', limit: 20, offset: 0 });
    expect(total).toBe(2);
  });
});
