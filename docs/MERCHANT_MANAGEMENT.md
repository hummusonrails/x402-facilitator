# Merchant Management Guide

## Overview

Merchants are now stored in the PostgreSQL database instead of environment variables. This provides better scalability, security, and management capabilities.

## Database Schema

```sql
CREATE TABLE merchants (
  address TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_key_hash TEXT NOT NULL,
  enabled BOOLEAN DEFAULT true,
  rate_limit INTEGER DEFAULT 50,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Adding a Merchant

### Step 1: Generate API Key

```bash
cd facilitator
pnpm generate-api-key
```

Output:
```
============================================================
API Key Generated
============================================================

API Key (give to merchant):
a1b2c3d4e5f6789...

Bcrypt Hash (store in .env):
$2b$10$abcdefghijklmnopqrstuvwxyz...

IMPORTANT:
1. Give the API Key to the merchant (send securely)
2. Store the Bcrypt Hash in your .env file
3. Never store the plain API key
============================================================
```

### Step 2: Add Merchant to Database

**Option A: Using the management script (recommended)**

```bash
pnpm merchants add 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb "MerchantA" "$2b$10$..."
```

**Option B: Direct SQL**

```sql
INSERT INTO merchants (address, name, api_key_hash)
VALUES (
  '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
  'MerchantA',
  '$2b$10$abcdefghijklmnopqrstuvwxyz...'
);
```

### Step 3: Share API Key with Merchant

Send the plain API key to the merchant securely (encrypted email, password manager, etc.). They will use this in their `X-API-Key` header when calling the settlement endpoint.

## Managing Merchants

### List All Merchants

```bash
pnpm merchants list
```

Output:
```
Registered Merchants:
================================================================================
Address:    0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb
Name:       MerchantA
Enabled:    true
Rate Limit: 50 req/15min
Created:    2024-11-04T08:30:00.000Z
--------------------------------------------------------------------------------
Total: 1 merchant(s)
```

### Disable a Merchant

Temporarily disable a merchant without deleting them:

```bash
pnpm merchants disable 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb
```

The merchant's API key will no longer work until re-enabled.

### Enable a Merchant

Re-enable a disabled merchant:

```bash
pnpm merchants enable 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb
```

### Delete a Merchant

Permanently remove a merchant:

```bash
pnpm merchants delete 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb
```

Warning: This cannot be undone. The merchant will need to be re-added with a new API key.

## Rotating API Keys

To rotate a merchant's API key:

### Step 1: Generate New Key

```bash
pnpm generate-api-key
```

### Step 2: Update Database

```sql
UPDATE merchants
SET api_key_hash = '$2b$10$new_hash_here...'
WHERE address = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb';
```

### Step 3: Notify Merchant

Send the new API key to the merchant. Their old key will stop working immediately.

## Authentication Flow

1. Merchant sends request to `/settle` with `X-API-Key` header
2. Facilitator queries database for merchants (cached for 1 minute)
3. Bcrypt compares provided key against stored hashes
4. If match found and merchant is enabled, request proceeds
5. Merchant address from database is used (not from client request)

## Security Features

### API Key Hashing

- API keys are hashed with bcrypt (10 rounds)
- Plain keys are never stored in the database
- Comparison is done securely with bcrypt.compare()

### Merchant Cache

- Merchants are cached in memory for 1 minute
- Reduces database load
- Cache refreshes automatically
- New merchants available within 1 minute

### Address Trust Boundary

- Client cannot specify merchant address
- Address comes from authenticated merchant record
- Prevents merchant address spoofing

## Rate Limiting

Each merchant can have a custom rate limit:

```sql
UPDATE merchants
SET rate_limit = 100
WHERE address = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb';
```

Note: Per-merchant rate limiting is not yet implemented in the code, but the database field is ready.

## Monitoring

### Check Merchant Activity

```sql
SELECT 
  m.address,
  m.name,
  COUNT(p.nonce) as payment_count,
  SUM(p.total_amount) as total_volume
FROM merchants m
LEFT JOIN payments p ON LOWER(p.merchant_address) = LOWER(decode(substring(m.address from 3), 'hex'))
WHERE p.created_at > NOW() - INTERVAL '24 hours'
GROUP BY m.address, m.name
ORDER BY payment_count DESC;
```

### Find Inactive Merchants

```sql
SELECT address, name, created_at
FROM merchants
WHERE enabled = true
AND address NOT IN (
  SELECT DISTINCT '0x' || encode(merchant_address, 'hex')
  FROM payments
  WHERE created_at > NOW() - INTERVAL '30 days'
);
```

## Migration from Environment Variables

If you previously used `MERCHANT_ADDRESSES` in `.env`:

### Step 1: Export Current Merchants

Old format:
```env
MERCHANT_ADDRESSES=0xAddr1,Name1;0xAddr2,Name2
```

### Step 2: Generate Keys for Each

```bash
# For each merchant
pnpm generate-api-key
```

### Step 3: Add to Database

```bash
pnpm merchants add 0xAddr1 "Name1" "$2b$10$hash1..."
pnpm merchants add 0xAddr2 "Name2" "$2b$10$hash2..."
```

### Step 4: Remove from .env

Delete or comment out `MERCHANT_ADDRESSES` line.

### Step 5: Restart Facilitator

```bash
pnpm dev
```

Verify merchants loaded:
```
Registered Merchants: 2
```

## Troubleshooting

### "Invalid API key"

**Cause:** API key doesn't match any merchant hash in database

**Fix:**
1. Verify merchant exists: `pnpm merchants list`
2. Check API key was copied correctly
3. Regenerate key if needed

### "Merchant account disabled"

**Cause:** Merchant's `enabled` flag is false

**Fix:**
```bash
pnpm merchants enable 0x...
```

### "Merchant not registered"

**Cause:** Merchant address not in database

**Fix:**
```bash
pnpm merchants add 0x... "Name" "$2b$10$..."
```

### Cache Not Updating

**Cause:** Merchant cache TTL is 1 minute

**Fix:** Wait 60 seconds or restart facilitator

## Best Practices

### Security

1. Generate strong random API keys (use the script)
2. Never commit API keys to git
3. Send keys securely (encrypted channels)
4. Rotate keys periodically (every 90 days)
5. Disable unused merchants instead of deleting

### Operations

1. Keep merchant names descriptive
2. Document which merchant owns which address
3. Monitor merchant activity regularly
4. Set appropriate rate limits per merchant
5. Audit merchant list quarterly

### Backup

Include merchants table in database backups:

```bash
pg_dump $DATABASE_URL -t merchants > merchants_backup.sql
```

Restore:

```bash
psql $DATABASE_URL < merchants_backup.sql
```

## API Reference

### Management Script

```bash
# List all merchants
pnpm merchants list

# Add new merchant
pnpm merchants add <address> <name> <apiKeyHash>

# Enable merchant
pnpm merchants enable <address>

# Disable merchant
pnpm merchants disable <address>

# Delete merchant
pnpm merchants delete <address>
```

### Database Functions

See `src/merchantStore.ts` for programmatic access:

- `getMerchantByAddress(address)` - Get merchant by address
- `getMerchantByApiKey(hash)` - Get merchant by API key hash
- `getAllMerchants()` - Get all merchants
- `addMerchant(address, name, hash)` - Add new merchant
- `setMerchantEnabled(address, enabled)` - Enable/disable merchant
- `updateMerchantApiKey(address, hash)` - Rotate API key
- `deleteMerchant(address)` - Delete merchant

## Summary

Merchant management is now database-driven, providing:

- Scalable merchant registration
- Secure API key storage (bcrypt)
- Easy enable/disable without deletion
- Per-merchant rate limits (ready for implementation)
- Complete audit trail
- Simple management CLI

All merchant operations are logged and can be audited through the database.
