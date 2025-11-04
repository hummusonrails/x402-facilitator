#!/usr/bin/env ts-node
/**
 * Utility script to manage merchants in the database
 * Usage:
 *   pnpm tsx scripts/manage-merchants.ts list
 *   pnpm tsx scripts/manage-merchants.ts add <address> <name> <apiKeyHash>
 *   pnpm tsx scripts/manage-merchants.ts disable <address>
 *   pnpm tsx scripts/manage-merchants.ts enable <address>
 *   pnpm tsx scripts/manage-merchants.ts delete <address>
 */

import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function listMerchants() {
  const result = await pool.query(
    `SELECT address, name, enabled, rate_limit, created_at
     FROM merchants
     ORDER BY created_at DESC`
  );

  console.log('\nRegistered Merchants:');
  console.log('='.repeat(80));
  
  if (result.rows.length === 0) {
    console.log('No merchants registered');
  } else {
    result.rows.forEach(row => {
      console.log(`Address:    ${row.address}`);
      console.log(`Name:       ${row.name}`);
      console.log(`Enabled:    ${row.enabled}`);
      console.log(`Rate Limit: ${row.rate_limit} req/15min`);
      console.log(`Created:    ${row.created_at}`);
      console.log('-'.repeat(80));
    });
  }
  
  console.log(`Total: ${result.rows.length} merchant(s)\n`);
}

async function addMerchant(address: string, name: string, apiKeyHash: string) {
  try {
    await pool.query(
      `INSERT INTO merchants (address, name, api_key_hash)
       VALUES ($1, $2, $3)`,
      [address, name, apiKeyHash]
    );
    console.log(`\nMerchant added successfully:`);
    console.log(`  Address: ${address}`);
    console.log(`  Name: ${name}\n`);
  } catch (error: any) {
    if (error.code === '23505') {
      console.error(`\nError: Merchant with address ${address} already exists\n`);
    } else {
      console.error(`\nError adding merchant: ${error.message}\n`);
    }
    process.exit(1);
  }
}

async function setMerchantEnabled(address: string, enabled: boolean) {
  const result = await pool.query(
    `UPDATE merchants
     SET enabled = $1
     WHERE LOWER(address) = LOWER($2)`,
    [enabled, address]
  );

  if (result.rowCount === 0) {
    console.error(`\nError: Merchant ${address} not found\n`);
    process.exit(1);
  }

  console.log(`\nMerchant ${enabled ? 'enabled' : 'disabled'}: ${address}\n`);
}

async function deleteMerchant(address: string) {
  const result = await pool.query(
    `DELETE FROM merchants
     WHERE LOWER(address) = LOWER($1)`,
    [address]
  );

  if (result.rowCount === 0) {
    console.error(`\nError: Merchant ${address} not found\n`);
    process.exit(1);
  }

  console.log(`\nMerchant deleted: ${address}\n`);
}

async function main() {
  const command = process.argv[2];

  try {
    switch (command) {
      case 'list':
        await listMerchants();
        break;

      case 'add':
        const address = process.argv[3];
        const name = process.argv[4];
        const apiKeyHash = process.argv[5];

        if (!address || !name || !apiKeyHash) {
          console.error('\nUsage: pnpm tsx scripts/manage-merchants.ts add <address> <name> <apiKeyHash>\n');
          process.exit(1);
        }

        await addMerchant(address, name, apiKeyHash);
        break;

      case 'enable':
        const enableAddress = process.argv[3];
        if (!enableAddress) {
          console.error('\nUsage: pnpm tsx scripts/manage-merchants.ts enable <address>\n');
          process.exit(1);
        }
        await setMerchantEnabled(enableAddress, true);
        break;

      case 'disable':
        const disableAddress = process.argv[3];
        if (!disableAddress) {
          console.error('\nUsage: pnpm tsx scripts/manage-merchants.ts disable <address>\n');
          process.exit(1);
        }
        await setMerchantEnabled(disableAddress, false);
        break;

      case 'delete':
        const deleteAddress = process.argv[3];
        if (!deleteAddress) {
          console.error('\nUsage: pnpm tsx scripts/manage-merchants.ts delete <address>\n');
          process.exit(1);
        }
        await deleteMerchant(deleteAddress);
        break;

      default:
        console.log('\nMerchant Management Tool\n');
        console.log('Usage:');
        console.log('  pnpm tsx scripts/manage-merchants.ts list');
        console.log('  pnpm tsx scripts/manage-merchants.ts add <address> <name> <apiKeyHash>');
        console.log('  pnpm tsx scripts/manage-merchants.ts enable <address>');
        console.log('  pnpm tsx scripts/manage-merchants.ts disable <address>');
        console.log('  pnpm tsx scripts/manage-merchants.ts delete <address>');
        console.log('\nExamples:');
        console.log('  # Generate API key first');
        console.log('  pnpm generate-api-key');
        console.log('');
        console.log('  # Add merchant with generated hash');
        console.log('  pnpm tsx scripts/manage-merchants.ts add 0x742d35Cc... "MerchantA" "$2b$10$..."');
        console.log('');
        console.log('  # List all merchants');
        console.log('  pnpm tsx scripts/manage-merchants.ts list');
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
