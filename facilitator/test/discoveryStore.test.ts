import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

function migration(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), 'utf8');
}

// discoveryStore imports the pool at module load, so the URL has to be set first
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;
const storeModule = TEST_DATABASE_URL ? import('../src/discoveryStore.js') : (null as never);
const dbModule = TEST_DATABASE_URL ? import('../src/db.js') : (null as never);

const MERCHANT_A = '0xa4d50e386Fa77d3EE3D4F7e8246dE21F4828eeF4' as const;
const MERCHANT_B = '0xe7D03950f92DbD90Ce626286DCCc8768dEE09ad1' as const;
const ORIGIN = 'https://api.example.com';

if (TEST_DATABASE_URL) {
  beforeAll(async () => {
    const { pool } = await dbModule;
    // 007 references merchants(address), and the listing checks merchants.approved (003).
    // Neither 002 nor 003 is idempotent, so apply each only once.
    const { rows } = await pool.query(`SELECT to_regclass('merchants') IS NOT NULL AS present`);
    if (!rows[0].present) await pool.query(migration('002_merchants.sql'));
    const { rows: cols } = await pool.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'merchants' AND column_name = 'approved'`
    );
    if (cols.length === 0) await pool.query(migration('003_merchant_approval.sql'));
  });

  beforeEach(async () => {
    const { pool } = await dbModule;
    await pool.query(migration('006_discovery_resources.sql'));
    await pool.query(migration('007_discovery_origins.sql'));
    // TRUNCATE fires no row triggers, so this resets state without exercising the cascade
    await pool.query('TRUNCATE discovery_resources, discovery_merchant_origins');
    await pool.query('DELETE FROM merchants WHERE address = ANY($1)', [[MERCHANT_A, MERCHANT_B]]);
    await pool.query(
      `INSERT INTO merchants (address, name, api_key_hash, enabled, approved) VALUES ($1, 'A', 'x', true, true), ($2, 'B', 'x', true, true)`,
      [MERCHANT_A, MERCHANT_B]
    );
  });

  afterAll(async () => {
    const { closePool } = await dbModule;
    await closePool();
  });
}

describeDb('upsertDiscoveryResource ownership', () => {
  // Same address as A, different casing: equality rests on decode(substr($7, 3), 'hex')
  const MERCHANT_A_LOWER = MERCHANT_A.toLowerCase() as `0x${string}`;

  const RESOURCE = 'https://api.example.com/analyze';

  function requirement(amount: string, payTo: string) {
    return { scheme: 'exact', network: 'eip155:421614', amount, asset: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', payTo };
  }

  function upsertArgs(merchantAddress: `0x${string}`, amount: string, payTo: string, nonce: string) {
    return {
      resourceUrl: RESOURCE,
      origin: ORIGIN,
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
    // The listing serves registered origins only
    const { pool } = await dbModule;
    await pool.query(`INSERT INTO discovery_merchant_origins (origin, merchant_address) VALUES ($1, $2)`, [ORIGIN, MERCHANT_A]);
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

describeDb('origin registration (migration 007)', () => {
  async function query(sql: string, params: unknown[] = []) {
    const { pool } = await dbModule;
    return (await pool.query(sql, params)).rows;
  }

  /** A catalog row as indexing writes it: origin set from the canonical URL */
  async function index(merchant: `0x${string}`, resourceUrl: string, origin: string | null = ORIGIN) {
    const { upsertDiscoveryResource } = await storeModule;
    if (origin === null) {
      // A pre-007 row: written without an origin, as the old code did
      await query(
        `INSERT INTO discovery_resources (resource_url, resource_type, tool_name, x402_version, accepts, metadata, merchant_address, last_nonce)
         VALUES ($1, 'http', '', 2, '[]', '{}', decode(substr($2, 3), 'hex'), 'n')`,
        [resourceUrl, merchant]
      );
      return;
    }
    return upsertDiscoveryResource({
      resourceUrl,
      origin,
      type: 'http',
      x402Version: 2,
      requirement: { scheme: 'exact' },
      metadata: {},
      merchantAddress: merchant,
      nonce: '0x01',
    });
  }

  async function register(merchant: string, origin = ORIGIN) {
    await query(`INSERT INTO discovery_merchant_origins (origin, merchant_address) VALUES ($1, $2)`, [origin, merchant]);
  }

  async function count(origin = ORIGIN): Promise<number> {
    return (await query(`SELECT count(*)::int AS n FROM discovery_resources WHERE origin = $1`, [origin]))[0].n;
  }

  it('answers whether an origin is registered to a merchant, ignoring address case', async () => {
    const { isOriginRegistered } = await storeModule;
    await register(MERCHANT_A);

    expect(await isOriginRegistered(ORIGIN, MERCHANT_A)).toBe(true);
    expect(await isOriginRegistered(ORIGIN, MERCHANT_A.toLowerCase())).toBe(true);
    expect(await isOriginRegistered(ORIGIN, MERCHANT_B)).toBe(false);
    expect(await isOriginRegistered('https://other.example.com', MERCHANT_A)).toBe(false);
  });

  it('refuses a second merchant on the same origin', async () => {
    await register(MERCHANT_A);
    await expect(register(MERCHANT_B)).rejects.toMatchObject({ code: '23505' });
  });

  it('writes the origin it was given on insert and on update', async () => {
    await register(MERCHANT_A);
    expect(await index(MERCHANT_A, 'https://API.Example.com:443/x')).toBe('inserted');
    expect(await index(MERCHANT_A, 'https://API.Example.com:443/x')).toBe('updated');
    expect(await count()).toBe(1);
  });

  it('backfills pre-007 rows the way URL.origin normalizes, and deletes nothing doing it', async () => {
    await index(MERCHANT_A, 'https://API.Example.com:443/x', null);
    await index(MERCHANT_A, 'HTTP://shop.example.com:80/y', null);
    await index(MERCHANT_A, 'https://api.example.com:8443/z', null);
    await index(MERCHANT_A, 'https://bücher.example/w', null);

    await query(migration('007_discovery_origins.sql'));

    const rows = await query(`SELECT resource_url, origin FROM discovery_resources ORDER BY id`);
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      // Non-ASCII hosts are left NULL for the script, since URL.origin punycodes them
      const expected = /^[\x00-\x7f]*$/.test(row.resource_url) ? new URL(row.resource_url).origin : null;
      expect(row.origin).toBe(expected);
    }
  });

  it('removing a registration removes the entries on its origin', async () => {
    await register(MERCHANT_A);
    await index(MERCHANT_A, `${ORIGIN}/a`);
    await index(MERCHANT_A, `${ORIGIN}/b`);

    await query(`DELETE FROM discovery_merchant_origins WHERE origin = $1`, [ORIGIN]);
    expect(await count()).toBe(0);
  });

  it('deleting the merchant removes its registrations and their entries, so the origin is clean for the next owner', async () => {
    await register(MERCHANT_A);
    await index(MERCHANT_A, `${ORIGIN}/a`);

    await query(`DELETE FROM merchants WHERE address = $1`, [MERCHANT_A]);
    expect(await query(`SELECT * FROM discovery_merchant_origins`)).toHaveLength(0);
    expect(await count()).toBe(0);

    await register(MERCHANT_B);
    expect(await index(MERCHANT_B, `${ORIGIN}/a`)).toBe('inserted');
  });

  it('registering an origin removes other merchants\' entries on it and keeps the registrant\'s own', async () => {
    await index(MERCHANT_B, `${ORIGIN}/squat`);
    await index(MERCHANT_A, `${ORIGIN}/own`);

    await register(MERCHANT_A);
    const rows = await query(`SELECT resource_url FROM discovery_resources WHERE origin = $1`, [ORIGIN]);
    expect(rows.map((row) => row.resource_url)).toEqual([`${ORIGIN}/own`]);
  });

  it('moving an origin removes the previous holder\'s entries, so the new holder is not blocked', async () => {
    await register(MERCHANT_A);
    await index(MERCHANT_A, `${ORIGIN}/a`);

    await query(`UPDATE discovery_merchant_origins SET merchant_address = $2 WHERE origin = $1`, [ORIGIN, MERCHANT_B]);
    expect(await count()).toBe(0);
    expect(await index(MERCHANT_B, `${ORIGIN}/a`)).toBe('inserted');
  });

  it('serves only entries on an origin registered to their owner', async () => {
    const { listDiscoveryResources } = await storeModule;
    await register(MERCHANT_A);
    await index(MERCHANT_A, `${ORIGIN}/served`);
    // Left in place by the non-destructive migration, but none of these may be served:
    await index(MERCHANT_B, `${ORIGIN}/other-owner`); // registered origin, different owner
    await index(MERCHANT_A, 'https://unregistered.example.com/x', 'https://unregistered.example.com'); // origin nobody registered
    await index(MERCHANT_A, `${ORIGIN}/null-origin`, null); // origin the backfill left NULL

    const { items, total } = await listDiscoveryResources({ limit: 20, offset: 0 });
    expect(total).toBe(1);
    expect(items.map((item) => item.resource)).toEqual([`${ORIGIN}/served`]);

    // Past the last page the total comes from the same filter
    expect((await listDiscoveryResources({ limit: 20, offset: 5 })).total).toBe(1);
  });

  it('serves entries only while their owner is enabled and approved, the bar /settle sets', async () => {
    const { listDiscoveryResources } = await storeModule;
    await register(MERCHANT_A);
    await index(MERCHANT_A, `${ORIGIN}/served`);
    const served = async () => (await listDiscoveryResources({ limit: 20, offset: 0 })).items.map((item) => item.resource);

    expect(await served()).toEqual([`${ORIGIN}/served`]);

    await query(`UPDATE merchants SET enabled = false WHERE address = $1`, [MERCHANT_A]);
    expect(await served()).toEqual([]);
    expect((await listDiscoveryResources({ limit: 20, offset: 0 })).total).toBe(0);

    // Hidden, not deleted: re-enabling brings the entry back
    await query(`UPDATE merchants SET enabled = true WHERE address = $1`, [MERCHANT_A]);
    expect(await served()).toEqual([`${ORIGIN}/served`]);

    await query(`UPDATE merchants SET approved = false WHERE address = $1`, [MERCHANT_A]);
    expect(await served()).toEqual([]);
    // NULL counts as not approved, as it does in authenticateMerchant
    await query(`UPDATE merchants SET approved = NULL WHERE address = $1`, [MERCHANT_A]);
    expect(await served()).toEqual([]);
  });

  it('an update that is not a move deletes nothing', async () => {
    await register(MERCHANT_A);
    await index(MERCHANT_A, `${ORIGIN}/a`);
    // A row the cascade would take if it fired: another merchant's, written straight to the store
    await index(MERCHANT_B, `${ORIGIN}/b`);

    await query(`UPDATE discovery_merchant_origins SET created_at = now() - interval '1 day'`);
    await query(`UPDATE discovery_merchant_origins SET merchant_address = merchant_address`);
    expect(await count()).toBe(2);
  });

  describe('indexIfOriginRegistered against a concurrent move', () => {
    function args(merchant: `0x${string}`, resourceUrl = `${ORIGIN}/a`) {
      return {
        resourceUrl,
        origin: ORIGIN,
        type: 'http' as const,
        x402Version: 2,
        requirement: { scheme: 'exact' },
        metadata: {},
        merchantAddress: merchant,
        nonce: '0x01',
      };
    }

    /** Resolves once `n` backends are waiting on a lock, so the interleaving is deterministic */
    async function blockedOnLock(n: number) {
      for (let i = 0; i < 200; i++) {
        const [{ waiting }] = await query(
          `SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()`
        );
        if (waiting >= n) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`expected ${n} backend(s) waiting on a lock`);
    }

    it('writes nothing when a move commits while it waits on the registration', async () => {
      const { pool } = await dbModule;
      const { indexIfOriginRegistered } = await storeModule;
      await register(MERCHANT_A);

      const mover = await pool.connect();
      try {
        await mover.query('BEGIN');
        await mover.query(`UPDATE discovery_merchant_origins SET merchant_address = $2 WHERE origin = $1`, [ORIGIN, MERCHANT_B]);

        // A has the registration as far as committed data goes; FOR SHARE has to wait for the move
        const indexing = indexIfOriginRegistered(args(MERCHANT_A));
        await blockedOnLock(1);
        await mover.query('COMMIT');

        expect(await indexing).toBe('origin_not_registered');
      } finally {
        mover.release();
      }
      expect(await count()).toBe(0);
    });

    it('makes a move wait for an index already under way, and the move then clears the row', async () => {
      const { pool } = await dbModule;
      const { indexIfOriginRegistered } = await storeModule;
      await register(MERCHANT_A);

      // Holds the row's key uncommitted, so the index blocks in its upsert, after FOR SHARE
      const keyHolder = await pool.connect();
      const mover = await pool.connect();
      try {
        await keyHolder.query('BEGIN');
        await keyHolder.query(
          `INSERT INTO discovery_resources (resource_url, resource_type, tool_name, x402_version, accepts, metadata, merchant_address, last_nonce, origin)
           VALUES ($1, 'http', '', 2, '[]', '{}', decode(substr($2, 3), 'hex'), 'n', $3)`,
          [`${ORIGIN}/a`, MERCHANT_A, ORIGIN]
        );
        const indexing = indexIfOriginRegistered(args(MERCHANT_A));
        await blockedOnLock(1);

        const moving = mover.query(`UPDATE discovery_merchant_origins SET merchant_address = $2 WHERE origin = $1`, [ORIGIN, MERCHANT_B]);
        await blockedOnLock(2);

        await keyHolder.query('ROLLBACK');
        expect(await indexing).toBe('inserted');
        await moving;
      } finally {
        keyHolder.release();
        mover.release();
      }
      // The move ran after the index committed, so its trigger saw the row and removed it
      expect(await count()).toBe(0);
      const [{ merchant }] = await query(`SELECT merchant_address AS merchant FROM discovery_merchant_origins WHERE origin = $1`, [ORIGIN]);
      expect(merchant).toBe(MERCHANT_B);
    });

    it('reports an unregistered origin without writing', async () => {
      const { indexIfOriginRegistered } = await storeModule;
      await register(MERCHANT_B);
      expect(await indexIfOriginRegistered(args(MERCHANT_A))).toBe('origin_not_registered');
      expect(await count()).toBe(0);
    });
  });
});
