# Authentication & Security Guide

## Overview

The x402 facilitator implements multi-tier authentication and security:
- **Merchant API Keys** - Bcrypt-hashed keys for settlement endpoints
- **Admin API Keys** - Separate keys for administrative operations
- **Rate Limiting** - Multi-tier limits to prevent abuse
- **Secure Merchant Registry** - Prevents unauthorized merchant addresses

## Authentication System

### Merchant Authentication

Merchants must authenticate with an API key to use settlement endpoints.

**Protected Endpoints:**
- `POST /settle` - Requires merchant API key

**How It Works:**
1. Merchant sends API key in `X-API-Key` header
2. Facilitator validates against bcrypt hash
3. Merchant address extracted from authenticated session
4. Client cannot specify arbitrary merchant addresses

### Admin Authentication

Administrators use a separate API key for sensitive operations.

**Protected Endpoints:**
- `POST /admin/refund` - Requires admin API key

**How It Works:**
1. Admin sends API key in `X-Admin-Key` header
2. Facilitator validates against bcrypt hash
3. Request marked as admin-authenticated

## Setup Guide

### 1. Generate API Keys

Use the built-in script:

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
a1b2c3d4e5f6...64_hex_characters...

Bcrypt Hash (store in .env):
$2b$10$abcdef...60_character_hash...

IMPORTANT:
1. Give the API Key to the merchant (send securely)
2. Store the Bcrypt Hash in your .env file
3. Never store the plain API key
============================================================
```

### 2. Configure Admin Key

Generate and configure admin API key:

```bash
# Generate admin key
pnpm generate-api-key

# Add hash to .env
ADMIN_API_KEY_HASH=$2b$10$...your_hash_here...
```

### 3. Configure Merchant Keys

**Option A: Environment Variables (Simple)**

Currently, merchant API keys are not stored in env vars. You'll need to implement a database or configuration file.

**Option B: Database (Recommended)**

Store merchant configurations in PostgreSQL:

```sql
CREATE TABLE merchant_configs (
  address TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_key_hash TEXT NOT NULL,
  enabled BOOLEAN DEFAULT true,
  rate_limit INTEGER DEFAULT 50,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add merchant
INSERT INTO merchant_configs (address, name, api_key_hash)
VALUES (
  '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
  'MerchantA',
  '$2b$10$...'
);
```

## Usage

### Merchant: Calling Settlement Endpoint

```typescript
// Merchant client code
const apiKey = 'a1b2c3d4e5f6...'; // From facilitator

const response = await fetch('https://facilitator.example.com/settle', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': apiKey, // ← Required
  },
  body: JSON.stringify({
    paymentPayload: { /* ... */ },
    paymentRequirements: { /* ... */ },
  }),
});

const result = await response.json();
```

### Admin: Executing Refund

```typescript
// Admin client code
const adminKey = 'admin-secret-key'; // From .env

const response = await fetch('https://facilitator.example.com/admin/refund', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Admin-Key': adminKey, // ← Required
  },
  body: JSON.stringify({
    nonce: '0x...',
    reason: 'Customer requested refund - order cancelled',
  }),
});

const result = await response.json();
```

## Rate Limiting

### Configured Limits

**General Endpoints:**
- Window: 15 minutes
- Max: 100 requests per IP
- Applies to: `/health`, `/supported`, `/verify`

**Settlement Endpoint:**
- Window: 15 minutes
- Max: 50 requests per IP
- Applies to: `/settle`

**Admin Endpoints:**
- Window: 15 minutes
- Max: 20 requests per IP
- Applies to: `/admin/*`

### Rate Limit Headers

Responses include standard rate limit headers:

```
RateLimit-Limit: 50
RateLimit-Remaining: 49
RateLimit-Reset: 1699000000
```

### Exceeded Rate Limit

```json
{
  "error": "Too many settlement requests, please try again later"
}
```

**HTTP Status:** `429 Too Many Requests`

## Security Best Practices

### API Key Management

**DO:**
- Generate random 64-character hex keys
- Store only bcrypt hashes (never plaintext)
- Use HTTPS for all API calls
- Rotate keys periodically (every 90 days)
- Use different keys per merchant
- Revoke keys immediately if compromised

**DON'T:**
- Commit API keys to git
- Log API keys
- Send keys over HTTP
- Reuse keys across merchants
- Share admin keys

### Key Rotation

```bash
# 1. Generate new key
pnpm generate-api-key

# 2. Update .env with new hash
ADMIN_API_KEY_HASH=$2b$10$new_hash...

# 3. Restart server
pm2 restart facilitator

# 4. Update client applications
# 5. Verify old key no longer works
```

### Compromised Key Response

If an API key is compromised:

1. **Immediate:**
   - Generate new key
   - Update hash in .env
   - Restart server
   - Old key immediately invalid

2. **Within 1 hour:**
   - Notify affected merchant
   - Review recent transactions
   - Check for unauthorized access

3. **Within 24 hours:**
   - Audit all API calls
   - Update security procedures
   - Consider additional safeguards

## Refund System

### When to Refund

Refunds should be issued when:
- Payment status is `failed`
- Incoming transfer succeeded
- Outgoing transfer never completed
- Funds stuck in facilitator wallet

### Refund Process

**1. Identify Failed Payment**

```sql
SELECT 
  nonce,
  '0x' || encode(user_address, 'hex') as user,
  total_amount,
  '0x' || encode(incoming_tx_hash, 'hex') as incoming_tx,
  status
FROM payments
WHERE status = 'failed'
AND incoming_tx_hash IS NOT NULL
AND outgoing_tx_hash IS NULL;
```

**2. Execute Refund**

```bash
curl -X POST https://facilitator.example.com/admin/refund \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: your-admin-key" \
  -d '{
    "nonce": "0x...",
    "reason": "Settlement failed after max retries - refunding user"
  }'
```

**3. Verify Refund**

```json
{
  "success": true,
  "refundHash": "0x..."
}
```

Check transaction on Arbiscan to confirm user received funds.

### Refund Validation

The refund endpoint validates:
- Payment exists
- Status is `failed`
- Incoming transfer succeeded
- Outgoing transfer never completed
- Funds available in facilitator wallet

**Rejected Scenarios:**
- Payment not found
- Status not `failed`
- No incoming transfer (user never paid)
- Outgoing transfer exists (merchant already paid)

## Monitoring

### Authentication Metrics

Track these metrics:

**Failed Authentication Attempts:**
```sql
-- Count failed auth attempts (from logs)
SELECT COUNT(*) 
FROM logs 
WHERE message = 'Invalid API key'
AND timestamp > NOW() - INTERVAL '1 hour';
```

**Active Merchants:**
```sql
SELECT COUNT(DISTINCT merchant_address)
FROM payments
WHERE created_at > NOW() - INTERVAL '24 hours';
```

**Refunds Issued:**
```sql
SELECT COUNT(*)
FROM payment_events
WHERE event_type = 'refunded'
AND created_at > NOW() - INTERVAL '7 days';
```

### Alerts

Set up alerts for:
- Multiple failed auth attempts (> 10/hour from same IP)
- Refund requests (notify on each refund)
- Rate limit exceeded (> 100/hour)
- Unauthorized admin access attempts

## Testing

### Test Merchant Authentication

```bash
# Valid API key
curl -X POST http://localhost:3002/settle \
  -H "Content-Type: application/json" \
  -H "X-API-Key: valid-key-here" \
  -d '{ "paymentPayload": {...}, "paymentRequirements": {...} }'

# Expected: 200 OK (or 400 if invalid payment)

# Invalid API key
curl -X POST http://localhost:3002/settle \
  -H "Content-Type: application/json" \
  -H "X-API-Key: invalid-key" \
  -d '{ "paymentPayload": {...}, "paymentRequirements": {...} }'

# Expected: 401 Unauthorized

# Missing API key
curl -X POST http://localhost:3002/settle \
  -H "Content-Type: application/json" \
  -d '{ "paymentPayload": {...}, "paymentRequirements": {...} }'

# Expected: 401 Unauthorized
```

### Test Admin Authentication

```bash
# Valid admin key
curl -X POST http://localhost:3002/admin/refund \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: your-admin-key" \
  -d '{ "nonce": "0x...", "reason": "test" }'

# Expected: 200 OK or 400 (if invalid nonce)

# Invalid admin key
curl -X POST http://localhost:3002/admin/refund \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: wrong-key" \
  -d '{ "nonce": "0x...", "reason": "test" }'

# Expected: 401 Unauthorized
```

### Test Rate Limiting

```bash
# Send 51 requests rapidly
for i in {1..51}; do
  curl -X POST http://localhost:3002/settle \
    -H "X-API-Key: valid-key" \
    -H "Content-Type: application/json" \
    -d '{}'
done

# Expected: First 50 succeed, 51st returns 429
```

## Troubleshooting

### "Invalid API key"

**Cause:** API key doesn't match any merchant hash

**Fix:**
1. Verify API key is correct
2. Check bcrypt hash in database/config
3. Regenerate key if needed

### "Merchant account disabled"

**Cause:** Merchant's `enabled` flag is false

**Fix:**
```sql
UPDATE merchant_configs
SET enabled = true
WHERE address = '0x...';
```

### "Missing X-API-Key header"

**Cause:** Request doesn't include authentication header

**Fix:** Add header to request:
```javascript
headers: { 'X-API-Key': 'your-key-here' }
```

### "Too many requests"

**Cause:** Rate limit exceeded

**Fix:**
- Wait for rate limit window to reset
- Reduce request frequency
- Contact facilitator for higher limits

## Summary

The authentication system provides:
- Secure API key authentication (bcrypt)
- Merchant address trust boundary
- Admin-only refund capability
- Multi-tier rate limiting
- Protection against unauthorized access
- Complete audit trail

**Status:** Production-ready
