#!/usr/bin/env ts-node
/**
 * Utility script to generate API keys and their bcrypt hashes
 * Usage: pnpm tsx scripts/generate-api-key.ts
 */

import bcrypt from 'bcrypt';
import crypto from 'crypto';

async function generateApiKey() {
  // Generate random API key
  const apiKey = crypto.randomBytes(32).toString('hex');
  
  // Generate bcrypt hash
  const hash = await bcrypt.hash(apiKey, 10);
  
  console.log('='.repeat(60));
  console.log('API Key Generated');
  console.log('='.repeat(60));
  console.log('');
  console.log('API Key (give to merchant):');
  console.log(apiKey);
  console.log('');
  console.log('Bcrypt Hash (store in .env):');
  console.log(hash);
  console.log('');
  console.log('IMPORTANT:');
  console.log('1. Give the API Key to the merchant (send securely)');
  console.log('2. Store the Bcrypt Hash in your .env file');
  console.log('3. Never store the plain API key');
  console.log('');
  console.log('Example .env configuration:');
  console.log(`ADMIN_API_KEY_HASH=${hash}`);
  console.log('');
  console.log('='.repeat(60));
}

generateApiKey().catch(console.error);
