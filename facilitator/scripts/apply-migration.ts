#!/usr/bin/env tsx
/**
 * Apply a single migration file to DATABASE_URL.
 *
 * The repository has no migration runner: docker-compose mounts `migrations/` into
 * `docker-entrypoint-initdb.d`, which Postgres runs only when it initializes an empty
 * data directory. On a database that already exists, a new migration therefore has to be
 * applied deliberately — this script is how.
 *
 * Usage:
 *   pnpm migrate migrations/006_discovery_resources.sql
 *
 * Only migrations written to be idempotent (CREATE ... IF NOT EXISTS throughout) are safe
 * to run this way; 006 is. It does not track which migrations have run, so it will not
 * bring an old database up to date on its own.
 */

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: pnpm migrate <path-to-migration.sql>');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const path = resolve(process.cwd(), file);
  const sql = readFileSync(path, 'utf8');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });

  try {
    // One transaction, so a failure part-way leaves nothing behind
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    console.log(`Applied ${file}`);
  } catch (error: any) {
    console.error(`Failed to apply ${file}: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
