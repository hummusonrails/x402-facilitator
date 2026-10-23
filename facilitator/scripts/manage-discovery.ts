#!/usr/bin/env ts-node
/**
 * Utility script to manage the Bazaar discovery catalog in the database
 * Usage:
 *   pnpm discovery list
 *   pnpm discovery delete <url> [toolName]
 *
 * First writer wins and the protocol has no way to release a claimed entry, so this is
 * the operator's escape hatch. Deleting alone does not stop the merchant who claimed it
 * from reclaiming it on their next settlement: disable them first with
 * `pnpm merchants disable <address>`, give the one-minute merchant cache time to expire,
 * then delete.
 */

import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function listResources() {
  const result = await pool.query(
    `SELECT resource_url, tool_name, resource_type, '0x' || encode(merchant_address, 'hex') AS merchant,
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
  console.log('\nAn enabled owner reclaims these on their next settlement. If not done already:');
  const merchants: string[] = [...new Set<string>(result.rows.map(row => row.merchant))];
  merchants.forEach(merchant => console.log(`  pnpm merchants disable ${merchant}`));
  console.log('A disable reaches the facilitator within a minute (merchant cache); delete again after that');
  console.log('if the entry was reclaimed in between.\n');
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

      default:
        console.log('\nDiscovery Catalog Tool\n');
        console.log('Usage:');
        console.log('  pnpm discovery list');
        console.log('  pnpm discovery delete <url> [toolName]');
        console.log('\nExamples:');
        console.log('  # Stop the merchant who claimed a URL from reclaiming it (allow a minute to take effect)');
        console.log('  pnpm merchants disable 0x742d35Cc...');
        console.log('');
        console.log('  # Then release the URL (all tools if toolName is omitted)');
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
