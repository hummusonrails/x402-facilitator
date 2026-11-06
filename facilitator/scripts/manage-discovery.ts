#!/usr/bin/env ts-node
/**
 * Utility script to manage the Bazaar discovery catalog in the database
 * Usage:
 *   pnpm discovery list
 *   pnpm discovery delete <url> [toolName]
 *   pnpm discovery origins list [merchant]
 *   pnpm discovery origins add <merchant> <origin>
 *   pnpm discovery origins move <origin> <merchant>
 *   pnpm discovery origins remove <origin>
 *
 * A resource is catalogued only when its origin is registered to the merchant whose API key
 * settled the payment, one merchant per origin. Registering an origin removes any entries on
 * it held by other merchants, moving it removes the previous holder's entries, and removing
 * it (or deleting the merchant) removes every entry on it. Each command prints what it removed.
 */

import 'dotenv/config';
import { Pool, type PoolClient } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/** The origin the facilitator will compare against: URL.origin of a bare scheme://host[:port]. */
function normalizeOrigin(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error(`${input} is not a URL; expected an origin such as https://api.example.com`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${input} must be http or https`);
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error(`${input} is not a bare origin; drop the path, query, fragment and credentials (${parsed.origin})`);
  }
  return parsed.origin;
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function resolveMerchant(client: PoolClient, address: string): Promise<{ address: string; name: string }> {
  const { rows } = await client.query(
    `SELECT address, name FROM merchants WHERE LOWER(address) = LOWER($1)`,
    [address]
  );
  if (rows.length === 0) {
    throw new Error(`Merchant ${address} not found; see \`pnpm merchants list\``);
  }
  return rows[0];
}

async function registrationOf(client: PoolClient, origin: string): Promise<{ address: string; name: string | null } | null> {
  const { rows } = await client.query(
    `SELECT o.merchant_address AS address, m.name
     FROM discovery_merchant_origins o LEFT JOIN merchants m ON m.address = o.merchant_address
     WHERE o.origin = $1
     FOR UPDATE OF o`,
    [origin]
  );
  return rows[0] ?? null;
}

/** Catalog rows on `origin` not owned by `keeper` (all rows when keeper is null), which the triggers delete. */
async function countRowsOnOrigin(client: PoolClient, origin: string, keeper: string | null): Promise<number> {
  const { rows } = keeper === null
    ? await client.query(`SELECT count(*)::int AS n FROM discovery_resources WHERE origin = $1`, [origin])
    : await client.query(
        `SELECT count(*)::int AS n FROM discovery_resources
         WHERE origin = $1 AND merchant_address <> decode(regexp_replace(lower($2), '^0x', ''), 'hex')`,
        [origin, keeper]
      );
  return rows[0].n;
}

/**
 * Pre-007 rows the migration could not normalize have origin NULL, so the triggers cannot
 * see them, yet they still hold their (resource_url, tool_name) key. Normalize them here,
 * the same way the facilitator does, and delete those on `origin` not owned by `keeper`.
 */
async function deleteUnnormalizedRows(client: PoolClient, origin: string, keeper: string | null): Promise<number> {
  const { rows } = await client.query(
    `SELECT id, resource_url, '0x' || encode(merchant_address, 'hex') AS merchant
     FROM discovery_resources WHERE origin IS NULL`
  );
  const ids = rows
    .filter(row => originOf(row.resource_url) === origin)
    .filter(row => keeper === null || row.merchant.toLowerCase() !== keeper.toLowerCase())
    .map(row => row.id);
  if (ids.length === 0) return 0;
  const result = await client.query(`DELETE FROM discovery_resources WHERE id = ANY($1::bigint[])`, [ids]);
  return result.rowCount ?? 0;
}

function entries(count: number): string {
  return `${count} catalog entr${count === 1 ? 'y' : 'ies'}`;
}

async function listResources() {
  const result = await pool.query(
    `SELECT resource_url, tool_name, resource_type, origin, '0x' || encode(merchant_address, 'hex') AS merchant,
            settle_count, last_updated
     FROM discovery_resources
     ORDER BY last_updated DESC`
  );

  console.log('\nDiscovery Resources:');
  console.log('='.repeat(80));

  if (result.rows.length === 0) {
    console.log('No resources indexed');
  } else {
    result.rows.forEach(row => {
      console.log(`URL:          ${row.resource_url}`);
      if (row.tool_name) console.log(`Tool:         ${row.tool_name}`);
      console.log(`Type:         ${row.resource_type}`);
      console.log(`Origin:       ${row.origin ?? '(not normalized)'}`);
      console.log(`Merchant:     ${row.merchant}`);
      console.log(`Settlements:  ${row.settle_count}`);
      console.log(`Last updated: ${row.last_updated}`);
      console.log('-'.repeat(80));
    });
  }

  console.log(`Total: ${result.rows.length} resource(s)\n`);
}

async function deleteResource(url: string, toolName?: string) {
  // Without a tool name every entry for the URL goes, so an MCP endpoint is released whole
  const result = toolName === undefined
    ? await pool.query(
        `DELETE FROM discovery_resources
         WHERE resource_url = $1
         RETURNING tool_name, '0x' || encode(merchant_address, 'hex') AS merchant`,
        [url]
      )
    : await pool.query(
        `DELETE FROM discovery_resources
         WHERE resource_url = $1 AND tool_name = $2
         RETURNING tool_name, '0x' || encode(merchant_address, 'hex') AS merchant`,
        [url, toolName]
      );

  if (result.rowCount === 0) {
    console.error(`\nError: No discovery entry for ${url}${toolName === undefined ? '' : ` (tool ${toolName})`}`);
    console.error('URLs must match exactly as stored; see `pnpm discovery list`\n');
    process.exit(1);
  }

  console.log(`\nDeleted ${result.rowCount} discovery entr${result.rowCount === 1 ? 'y' : 'ies'} for ${url}:`);
  result.rows.forEach(row => {
    console.log(`  ${row.tool_name || '(http)'}  owned by ${row.merchant}`);
  });
  console.log('\nThe owner can index these again on its next settlement while it holds the origin.');
  console.log('To take the origin away: pnpm discovery origins remove <origin> (or origins move).\n');
}

async function listOrigins(merchant?: string) {
  const result = await pool.query(
    `SELECT o.origin, o.merchant_address, m.name, o.created_at,
            (SELECT count(*)::int FROM discovery_resources d WHERE d.origin = o.origin) AS entries
     FROM discovery_merchant_origins o LEFT JOIN merchants m ON m.address = o.merchant_address
     WHERE $1::text IS NULL OR LOWER(o.merchant_address) = LOWER($1)
     ORDER BY o.merchant_address, o.origin`,
    [merchant ?? null]
  );

  console.log('\nRegistered Discovery Origins:');
  console.log('='.repeat(80));

  if (result.rows.length === 0) {
    console.log('No origins registered');
  } else {
    result.rows.forEach(row => {
      console.log(`Origin:     ${row.origin}`);
      console.log(`Merchant:   ${row.merchant_address}${row.name ? ` (${row.name})` : ''}`);
      console.log(`Entries:    ${row.entries}`);
      console.log(`Registered: ${row.created_at}`);
      console.log('-'.repeat(80));
    });
  }

  console.log(`Total: ${result.rows.length} origin(s)\n`);
}

async function addOrigin(merchantArg: string, originArg: string) {
  const origin = normalizeOrigin(originArg);

  const { merchant, removed } = await inTransaction(async client => {
    const merchant = await resolveMerchant(client, merchantArg);
    const holder = await registrationOf(client, origin);
    if (holder) {
      if (holder.address.toLowerCase() === merchant.address.toLowerCase()) {
        throw new Error(`${origin} is already registered to ${holder.address}`);
      }
      throw new Error(
        `${origin} is already registered to ${holder.address}${holder.name ? ` (${holder.name})` : ''}; ` +
        `use 'pnpm discovery origins move ${origin} ${merchant.address}'`
      );
    }

    const others = await countRowsOnOrigin(client, origin, merchant.address);
    const unnormalized = await deleteUnnormalizedRows(client, origin, merchant.address);
    try {
      // The insert trigger deletes the other merchants' entries counted above
      await client.query(
        `INSERT INTO discovery_merchant_origins (origin, merchant_address) VALUES ($1, $2)`,
        [origin, merchant.address]
      );
    } catch (error: any) {
      if (error.code === '23505') {
        throw new Error(`${origin} was registered by someone else meanwhile; see 'pnpm discovery origins list'`);
      }
      throw error;
    }
    return { merchant, removed: others + unnormalized };
  });

  console.log(`\nRegistered ${origin} to ${merchant.address} (${merchant.name})`);
  console.log(`Removed ${entries(removed)} on ${origin} held by other merchants\n`);
}

async function moveOrigin(originArg: string, merchantArg: string) {
  const origin = normalizeOrigin(originArg);

  const { holder, merchant, removed } = await inTransaction(async client => {
    const holder = await registrationOf(client, origin);
    if (!holder) {
      throw new Error(`${origin} is not registered; use 'pnpm discovery origins add'`);
    }
    const merchant = await resolveMerchant(client, merchantArg);
    if (holder.address.toLowerCase() === merchant.address.toLowerCase()) {
      throw new Error(`${origin} is already registered to ${holder.address}`);
    }

    const others = await countRowsOnOrigin(client, origin, merchant.address);
    const unnormalized = await deleteUnnormalizedRows(client, origin, merchant.address);
    // The move trigger deletes the entries counted above
    await client.query(
      `UPDATE discovery_merchant_origins SET merchant_address = $2 WHERE origin = $1`,
      [origin, merchant.address]
    );

    return { holder, merchant, removed: others + unnormalized };
  });

  console.log(`\nMoved ${origin} from ${holder.address} to ${merchant.address} (${merchant.name})`);
  console.log(`Removed ${entries(removed)} on ${origin} held by other merchants`);
  console.log(`${merchant.address} catalogues its resources again on its next settlement\n`);
}

async function removeOrigin(originArg: string) {
  const origin = normalizeOrigin(originArg);

  const { holder, removed } = await inTransaction(async client => {
    const holder = await registrationOf(client, origin);
    if (!holder) {
      throw new Error(`${origin} is not registered; see 'pnpm discovery origins list'`);
    }

    const all = await countRowsOnOrigin(client, origin, null);
    const unnormalized = await deleteUnnormalizedRows(client, origin, null);
    // The delete trigger deletes the entries counted above
    await client.query(`DELETE FROM discovery_merchant_origins WHERE origin = $1`, [origin]);

    return { holder, removed: all + unnormalized };
  });

  console.log(`\nRemoved 1 registration: ${origin} (was ${holder.address})`);
  console.log(`Removed ${entries(removed)} on ${origin}\n`);
}

function originsUsage() {
  console.log('\nUsage:');
  console.log('  pnpm discovery origins list [merchant]');
  console.log('  pnpm discovery origins add <merchant> <origin>');
  console.log('  pnpm discovery origins move <origin> <merchant>');
  console.log('  pnpm discovery origins remove <origin>\n');
}

async function main() {
  const command = process.argv[2];

  try {
    switch (command) {
      case 'list':
        await listResources();
        break;

      case 'delete':
        const url = process.argv[3];
        const toolName = process.argv[4];
        if (!url) {
          console.error('\nUsage: pnpm discovery delete <url> [toolName]\n');
          process.exit(1);
        }
        await deleteResource(url, toolName);
        break;

      case 'origins':
        const sub = process.argv[3];
        const first = process.argv[4];
        const second = process.argv[5];
        switch (sub) {
          case 'list':
            await listOrigins(first);
            break;

          case 'add':
            if (!first || !second) {
              console.error('\nUsage: pnpm discovery origins add <merchant> <origin>\n');
              process.exit(1);
            }
            await addOrigin(first, second);
            break;

          case 'move':
            if (!first || !second) {
              console.error('\nUsage: pnpm discovery origins move <origin> <merchant>\n');
              process.exit(1);
            }
            await moveOrigin(first, second);
            break;

          case 'remove':
            if (!first) {
              console.error('\nUsage: pnpm discovery origins remove <origin>\n');
              process.exit(1);
            }
            await removeOrigin(first);
            break;

          default:
            originsUsage();
            process.exit(1);
        }
        break;

      default:
        console.log('\nDiscovery Catalog Tool\n');
        console.log('Usage:');
        console.log('  pnpm discovery list');
        console.log('  pnpm discovery delete <url> [toolName]');
        console.log('  pnpm discovery origins list [merchant]');
        console.log('  pnpm discovery origins add <merchant> <origin>');
        console.log('  pnpm discovery origins move <origin> <merchant>');
        console.log('  pnpm discovery origins remove <origin>');
        console.log('\nExamples:');
        console.log('  # Let a merchant catalogue resources it serves on an origin');
        console.log('  pnpm discovery origins add 0x742d35Cc... https://api.example.com');
        console.log('');
        console.log('  # Hand the origin to another merchant (its old entries are removed)');
        console.log('  pnpm discovery origins move https://api.example.com 0x8ba1f109...');
        console.log('');
        console.log('  # Remove one entry (all tools if toolName is omitted)');
        console.log('  pnpm discovery delete https://api.example.com/analyze');
        console.log('');
        process.exit(1);
    }
  } catch (error: any) {
    console.error(`\nError: ${error.message}\n`);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
