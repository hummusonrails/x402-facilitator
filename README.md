# X402 Facilitator for Arbitrum

An x402 payment facilitator service for Arbitrum with multi-merchant support, automatic fee collection, persistent nonce storage, and failure recovery.

## Overview

This facilitator enables merchants to accept USDC payments on Arbitrum using the x402 HTTP payment protocol with EIP-3009 transfer authorizations. The service handles payment verification, onchain settlement, fee collection, and automatic recovery of failed transactions.

### Key Features

**Payment Processing**
- EIP-3009 transfer authorization verification and execution
- Two-step settlement flow: user to facilitator, facilitator to merchant
- Automatic fee calculation and collection (service fee + gas reimbursement)
- Support for multiple registered merchants
- Strict validation of network, token, recipient, amount, and timing

**Reliability and Recovery**
- PostgreSQL-based persistent nonce storage with advisory locks
- Automatic recovery worker for incomplete settlements
- Exponential backoff retry mechanism
- Manual refund capability for failed payments

**Operational**
- Structured logging with correlation IDs
- Health check endpoints
- Recovery worker monitoring
- Database connection pooling

## Quick Start

### Prerequisites

- Node.js
- PostgreSQL
- Private key for facilitator account (pays gas, receives fees)
- RPC access to Arbitrum networks

### Installation

```bash
cd facilitator
pnpm install
```

### Database Setup

**Local Development (Docker):**
```bash
# Start PostgreSQL
docker-compose up -d

# Migrations run automatically on first start
```

**Production:**
```bash
# Run migrations
psql $DATABASE_URL -f migrations/001_init.sql
psql $DATABASE_URL -f migrations/002_merchants.sql
```

### Configuration

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
# Network
NETWORK=arbitrum-sepolia

# Database (REQUIRED for production)
POSTGRES_USER=facilitator
POSTGRES_PASSWORD=create_a_secure_password_here
POSTGRES_DB=facilitator
POSTGRES_HOST=localhost
POSTGRES_PORT=5432

# Facilitator private key
FACILITATOR_PRIVATE_KEY=0x...

# Admin API key hash (generate with: pnpm generate-api-key)
ADMIN_API_KEY_HASH=$2b$10$...

# Fee configuration
SERVICE_FEE_BPS=50        # 0.5%
GAS_FEE_USDC=100000       # 0.1 USDC

# Merchants are stored in database (see docs/MERCHANT_MANAGEMENT.md)
# Add merchants with: pnpm merchants add <address> <name> <apiKeyHash>
```

### Generate API Keys

1. **Admin API Key** (ONE key for refunds)
2. **Merchant API Keys** (MANY keys, one per merchant)

```bash
# Generate a key
pnpm generate-api-key
```

This generates:
- API key (plain text - give to user)
- Bcrypt hash (store in database or `.env`)

### Running

**Development:**
```bash
pnpm dev
```

**Production:**
```bash
pnpm build
pnpm start
```

**Docker:**
```bash
docker build -t x402-facilitator .
docker run -p 3002:3002 --env-file .env x402-facilitator
```

## API Endpoints

### Public Endpoints

**`GET /health`**

Health check with network information.

```json
{
  "status": "ok",
  "network": "arbitrum-sepolia",
  "chainId": 421614,
  "timestamp": 1699000000000
}
```

**`GET /supported`**

Returns supported payment kinds.

```json
{
  "kinds": [
    {
      "x402Version": 1,
      "scheme": "exact",
      "network": "arbitrum"
    },
    {
      "x402Version": 1,
      "scheme": "exact",
      "network": "arbitrum-sepolia"
    }
  ]
}
```

**`POST /verify`**

Verifies payment payload without executing settlement. No authentication required.

Request:
```json
{
  "paymentPayload": {
    "scheme": "exact",
    "network": "arbitrum-sepolia",
    "payload": {
      "from": "0x...",
      "to": "0xFacilitatorAddress",
      "value": "1105000",
      "validAfter": 0,
      "validBefore": 1735689600,
      "nonce": "0x...",
      "v": 27,
      "r": "0x...",
      "s": "0x..."
    }
  },
  "paymentRequirements": {
    "scheme": "exact",
    "network": "arbitrum-sepolia",
    "token": "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    "amount": "1105000",
    "recipient": "0xFacilitatorAddress",
    "merchantAddress": "0xMerchantAddress",
    "description": "Payment for service",
    "maxTimeoutSeconds": 300
  }
}
```

Response:
```json
{
  "valid": true
}
```

### Authenticated Endpoints

**`POST /settle`**

Executes onchain settlement. Requires merchant API key.

Headers:
```
X-API-Key: merchant-api-key
```

Request: Same as `/verify`

Response:
```json
{
  "success": true,
  "transactionHash": "0x...",
  "incomingTransactionHash": "0x...",
  "outgoingTransactionHash": "0x...",
  "blockNumber": 12345678,
  "status": "confirmed",
  "merchantAddress": "0x...",
  "feeBreakdown": {
    "merchantAmount": "1000000",
    "serviceFee": "5000",
    "gasFee": "100000",
    "totalAmount": "1105000"
  }
}
```

### Admin Endpoints

**`POST /admin/refund`**

Executes refund for failed payment. Requires admin API key.

Headers:
```
X-Admin-Key: admin-api-key
```

Request:
```json
{
  "nonce": "0x...",
  "reason": "Settlement failed after max retries"
}
```

Response:
```json
{
  "success": true,
  "refundHash": "0x..."
}
```

## Fee Model

### How Fees Work

The facilitator collects two types of fees:

1. **Service Fee**: Percentage of merchant amount (default 0.5%)
2. **Gas Fee**: Fixed USDC amount to cover transaction costs (default 0.1 USDC)

### Payment Flow

```
User pays total amount (merchant amount + fees)
  |
  v
Facilitator receives total
  |
  +---> Forwards merchant amount to merchant
  |
  +---> Keeps service fee + gas fee
```

### Example Calculation

For a 1 USDC merchant payment:

```
Merchant Amount:  1.000000 USDC  (goes to merchant)
Service Fee:      0.005000 USDC  (0.5% of merchant amount)
Gas Fee:          0.100000 USDC  (fixed)
-----------------------------------------
Total User Pays:  1.105000 USDC
```

### Fee Configuration

```env
SERVICE_FEE_BPS=50        # 50 basis points = 0.5%
GAS_FEE_USDC=100000       # 0.1 USDC (6 decimals)
```

## Network Support

### Arbitrum One (Mainnet)

- **Network**: `arbitrum`
- **Chain ID**: 42161
- **USDC**: `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` (native USDC)
- **RPC**: `https://arb1.arbitrum.io/rpc`

### Arbitrum Sepolia (Testnet)

- **Network**: `arbitrum-sepolia`
- **Chain ID**: 421614
- **USDC**: `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` (test USDC)
- **RPC**: `https://sepolia-rollup.arbitrum.io/rpc`

## Architecture

### Payment State Machine

```
pending
  |
  v
incoming_submitted (user -> facilitator tx submitted)
  |
  v
incoming_complete (user -> facilitator tx confirmed)
  |
  v
outgoing_submitted (facilitator -> merchant tx submitted)
  |
  v
complete (facilitator -> merchant tx confirmed)

  OR
  |
  v
failed (terminal state, requires manual refund)
```

### Recovery System

The recovery worker runs every 5 minutes (configurable) and:

1. Queries database for incomplete payments
2. For payments in `incoming_complete`: retries outgoing transfer
3. For payments in `outgoing_submitted`: checks onchain status
4. Retries with exponential backoff (2s, 4s, 8s)
5. Marks as `failed` after max retries
6. Logs all recovery attempts for audit

## Security

### Authentication

**Merchant Authentication**
- API key required for `/settle` endpoint
- Keys stored as bcrypt hashes
- Merchant address extracted from authenticated session
- Prevents client-specified merchant addresses

**Admin Authentication**
- Separate API key for `/admin/*` endpoints
- Required for refund operations
- Higher security threshold

### Rate Limiting

- **General endpoints**: 100 requests per 15 minutes per IP
- **Settlement endpoint**: 50 requests per 15 minutes per IP
- **Admin endpoints**: 20 requests per 15 minutes per IP

### Validation

**Startup Validations**
- Database connectivity check
- Chain ID verification against RPC
- Token decimals verification (must be 6 for USDC)
- Fee configuration validation

**Payment Validations**
- EIP-3009 signature verification with domain parameters
- Timing bounds (validAfter <= now <= validBefore)
- Nonce uniqueness (PostgreSQL advisory locks)
- Network, token, and recipient address matching
- Amount validation (underflow guards, strict equality)
- Merchant registry check

## Database

### Queries

**Find incomplete payments:**
```sql
SELECT * FROM payments 
WHERE status IN ('incoming_complete', 'outgoing_submitted')
ORDER BY created_at ASC;
```

**Check recovery history:**
```sql
SELECT * FROM payment_events 
WHERE event_type LIKE 'recovery_%'
ORDER BY created_at DESC;
```

**Payment statistics:**
```sql
SELECT 
  status,
  COUNT(*) as count,
  SUM(total_amount) as total_volume
FROM payments
GROUP BY status;
```

## Merchant Integration

### Registration

1. Contact facilitator operator with merchant address
2. Operator generates API key: `pnpm generate-api-key`
3. Operator adds merchant to database: `pnpm merchants add <address> <name> <hash>`
4. Merchant receives API key securely

### Creating 402 Responses

```typescript
const merchantAmount = 1000000; // 1 USDC
const serviceFee = Math.floor(merchantAmount * 50 / 10000); // 0.5%
const gasFee = 100000; // 0.1 USDC
const totalAmount = merchantAmount + serviceFee + gasFee;

const paymentRequirements = {
  scheme: 'exact',
  network: 'arbitrum-sepolia',
  token: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
  amount: totalAmount.toString(),
  recipient: '0xFacilitatorAddress', // Facilitator, not merchant
  merchantAddress: '0xYourMerchantAddress',
  description: `Content + ${serviceFee/1e6} USDC fee + ${gasFee/1e6} USDC gas`,
  maxTimeoutSeconds: 300,
};

res.status(402).json({
  error: 'Payment Required',
  paymentRequirements,
  facilitatorUrl: 'https://facilitator.example.com',
});
```

### Calling Settlement

```typescript
const response = await fetch('https://facilitator.example.com/settle', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': 'your-merchant-api-key',
  },
  body: JSON.stringify({
    paymentPayload,
    paymentRequirements,
  }),
});

const result = await response.json();
console.log('Settlement:', result.transactionHash);
console.log('Merchant received:', result.feeBreakdown.merchantAmount);
```

## Operations

### Monitoring

**Health Check**
```bash
curl http://localhost:3002/health
```

**Database Status**
```sql
SELECT COUNT(*) FROM payments WHERE status = 'complete';
SELECT COUNT(*) FROM payments WHERE status = 'failed';
```

**Recovery Worker**
Check logs for:
- `Recovery worker started`
- `Found incomplete settlements`
- `Successfully recovered payment`

### Manual Refund

```bash
curl -X POST http://localhost:3002/admin/refund \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: your-admin-key" \
  -d '{
    "nonce": "0x...",
    "reason": "Settlement failed after max retries"
  }'
```

### Backup and Recovery

**Backup Database**
```bash
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql
```

**Restore Database**
```bash
psql $DATABASE_URL < backup_20241104_120000.sql
```

## Development

### Commands

```bash
# Type checking
pnpm check

# Build
pnpm build

# Run tests (if implemented)
pnpm test

# Clean build artifacts
pnpm clean

# Generate API key
pnpm generate-api-key
```

### Local Development

```bash
# Start database
docker-compose up -d

# Start facilitator
pnpm dev

# Check logs
tail -f logs/facilitator.log
```

## Additional Documentation

Detailed reference guides are available in the `docs/` directory:

- [`docs/DATABASE_SETUP.md`](docs/DATABASE_SETUP.md): Database configuration, advanced queries, and backup procedures
- [`docs/MERCHANT_MANAGEMENT.md`](docs/MERCHANT_MANAGEMENT.md): How to add, manage, and monitor merchants
- [`docs/AUTHENTICATION_GUIDE.md`](docs/AUTHENTICATION_GUIDE.md): Authentication setup, API key management, and testing
- [`docs/INTEGRATION_GUIDE.md`](docs/INTEGRATION_GUIDE.md): Complete merchant integration walkthrough with examples

## License

MIT - See [LICENSE](LICENSE)
