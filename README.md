# X402 Facilitator for Arbitrum

An x402 payment facilitator service for Arbitrum with multi-merchant support, automatic fee collection, persistent nonce storage, and failure recovery.

## Overview

This facilitator enables merchants to accept USDC payments on Arbitrum using the [x402 v2 protocol](https://github.com/x402-foundation/x402) with EIP-3009 `transferWithAuthorization`. It implements the standard facilitator API (`/verify`, `/settle`, `/supported`), so resource servers built with the official `@x402/*` SDKs can point at it directly. The service handles payment verification, onchain settlement, fee collection, and automatic recovery of failed transactions.

Buyers pay the facilitator's signer address. The facilitator pulls the payment to itself, keeps its fee, and forwards the merchant share to the merchant address tied to the API key used on `/settle`.

### Key Features

**Payment Processing**
- x402 `exact` scheme on EVM with EIP-3009 transfer authorizations (`assetTransferMethod: "eip3009"`)
- Two-step settlement flow: buyer to facilitator, facilitator to merchant
- Automatic fee calculation and collection (service fee + gas reimbursement)
- Support for multiple registered merchants, identified by API key
- Strict validation of network, asset, recipient, amount, timing, nonce, and signature (EOA, EIP-1271, and EIP-7702 delegated accounts)

**SDK Compatibility**
- Spec-compliant request and response shapes for `/verify`, `/settle`, and `/supported`
- Works with `HTTPFacilitatorClient` from [`@x402/core`](https://www.npmjs.com/package/@x402/core) and the official middleware (`@x402/express`, `@x402/next`) and clients (`@x402/fetch`)
- x402 v1 payloads remain accepted for backward compatibility
- `/requirements` helper for building a `PaymentRequired` object by hand

**Reliability and Recovery**
- PostgreSQL-based persistent nonce storage with advisory locks
- Idempotent `/settle`: retrying a pending settlement reconciles against the broadcast transaction instead of rebroadcasting
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
- Private key for facilitator account (pays gas, receives payments and fees)
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
psql $DATABASE_URL -f migrations/003_merchant_approval.sql
psql $DATABASE_URL -f migrations/004_merchant_contact_info.sql
psql $DATABASE_URL -f migrations/005_add_fee_columns.sql
```

### Configuration

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
# Network this instance settles on (exactly one per instance)
# CAIP-2: eip155:421614 (Arbitrum Sepolia) or eip155:42161 (Arbitrum One)
# Legacy names arbitrum-sepolia / arbitrum are still accepted
NETWORK=eip155:421614

# Database (REQUIRED for production)
POSTGRES_USER=facilitator
POSTGRES_PASSWORD=create_a_secure_password_here
POSTGRES_DB=facilitator
POSTGRES_HOST=localhost
POSTGRES_PORT=5432

# Facilitator private key (placeholder, use your actual private key)
FACILITATOR_PRIVATE_KEY=0x0000000000000000000000000000000000000000000000000000000000000000

# Admin API key hash (generate with: pnpm generate-api-key)
# Placeholder example, do not use in production
ADMIN_API_KEY_HASH=$2b$10$placeholder.hash.do.not.use.in.production

# Fee configuration
SERVICE_FEE_BPS=50        # 0.5%
GAS_FEE_USDC=100000       # 0.1 USDC

# Settlement limits and timeouts
MAX_SETTLEMENT_AMOUNT=1000000000           # 1000 USDC
SETTLEMENT_CONFIRMATION_TIMEOUT_MS=180000  # wait this long for a receipt before returning settlement_pending

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

Example output:
```
API Key (plain text - give to merchant securely):
xyz_abc123def456...

Bcrypt Hash (store in database or .env):
$2b$10$abcdefghijklmnopqrstuvwxyz...
```

**Security Note:** 
- Give the **API Key** (plain text) to the merchant securely
- Store only the **Bcrypt Hash** in your database or `.env` file
- Never store or transmit plain text API keys in your codebase

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

**Important:** All code examples below use placeholder values. Never hardcode real API keys, private keys, or sensitive data in documentation or source code.

The request and response shapes follow the [x402 v2 specification](https://github.com/x402-foundation/x402/tree/main/specs). Amounts are strings in USDC base units (6 decimals), so `"500000"` is 0.50 USDC.

### Public Endpoints

**`GET /health`**

Health check with network information.

```json
{
  "status": "ok",
  "network": "eip155:421614",
  "chainId": 421614,
  "timestamp": 1699000000000
}
```

**`GET /supported`**

Returns the payment kinds this instance supports and its signer address. Each instance settles on exactly one network, advertised once as x402 v2 (CAIP-2 id) and once as v1 (legacy name).

```json
{
  "kinds": [
    { "x402Version": 2, "scheme": "exact", "network": "eip155:421614" },
    { "x402Version": 1, "scheme": "exact", "network": "arbitrum-sepolia" }
  ],
  "extensions": [],
  "signers": {
    "eip155:*": ["0xFacilitatorAddress"]
  }
}
```

The address in `signers["eip155:*"]` is the `payTo` address resource servers must put in their payment requirements.

**`POST /verify`**

Checks a payment without executing it. No authentication required. `/verify` is read-only: it does not record the nonce, so a resource server can verify and later settle the same payload.

Request:
```json
{
  "x402Version": 2,
  "paymentPayload": {
    "x402Version": 2,
    "resource": {
      "url": "https://api.example.com/premium-content",
      "description": "Access to premium content",
      "mimeType": "application/json"
    },
    "accepted": {
      "scheme": "exact",
      "network": "eip155:421614",
      "amount": "500000",
      "asset": "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
      "payTo": "0xFacilitatorAddress",
      "maxTimeoutSeconds": 300,
      "extra": { "name": "USD Coin", "version": "2" }
    },
    "payload": {
      "signature": "0xSIGNATURE",
      "authorization": {
        "from": "0xPayerAddress",
        "to": "0xFacilitatorAddress",
        "value": "500000",
        "validAfter": "1740672089",
        "validBefore": "1740672389",
        "nonce": "0xUNIQUE32BYTENONCE"
      }
    }
  },
  "paymentRequirements": {
    "scheme": "exact",
    "network": "eip155:421614",
    "amount": "500000",
    "asset": "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    "payTo": "0xFacilitatorAddress",
    "maxTimeoutSeconds": 300,
    "extra": { "name": "USD Coin", "version": "2" }
  }
}
```

Response (200):
```json
{ "isValid": true, "payer": "0xPayerAddress" }
```

```json
{
  "isValid": false,
  "invalidReason": "invalid_exact_evm_payload_authorization_valid_before",
  "payer": "0xPayerAddress"
}
```

Some failures also include a human-readable `invalidMessage`.

A malformed request returns 400 with `isValid: false` and `invalidReason` set to `invalid_payload`, `invalid_payment_requirements`, `invalid_x402_version`, or `unsupported_payload_type`.

What verification checks:
- `scheme` is `exact` and `network` matches this instance
- `paymentPayload.accepted` matches `paymentRequirements` (v2)
- `asset` is USDC and `extra.name` / `extra.version` match its EIP-712 domain (`"USD Coin"`, `"2"`)
- `payTo` is the facilitator and `authorization.to` equals `payTo`
- Signature, checked the same way USDC's `SignatureChecker` does: `ecrecover` for EOAs, EIP-1271 for smart wallets and EIP-7702 delegated EOAs (undeployed ERC-6492 wallets are not supported)
- `validAfter <= now` and `validBefore >= now + 6s`
- `authorization.value` equals `amount` exactly; `amount` covers the gas fee and does not exceed `MAX_SETTLEMENT_AMOUNT`
- Nonce unused (database and onchain `authorizationState`), payer balance, and a `transferWithAuthorization` simulation

Only the EIP-3009 transfer method (the spec default) is supported. Payloads using Permit2 or ERC-7710 are rejected with `unsupported_payload_type`.

**x402 v1 (backward compatibility):** v1 payloads are still accepted. Send `{"x402Version": 1, "paymentPayload": {"x402Version": 1, "scheme": "exact", "network": "arbitrum-sepolia", "payload": {"signature", "authorization"}}, "paymentRequirements": {...}}` where the v1 requirements carry `scheme`, `network`, `maxAmountRequired`, `resource`, `description`, `mimeType`, `payTo`, `maxTimeoutSeconds`, `asset`, and `extra`.

**`GET /requirements`** and **`POST /requirements`**

Optional helper that builds a `PaymentRequired` object with the correct `payTo`, `asset`, and `extra` for this instance. Resource servers using the official SDKs do not need it. It returns 200 (not 402) with the object in the body and, for v2, the same object base64-encoded in the `PAYMENT-REQUIRED` header.

```bash
curl "http://localhost:3002/requirements?amount=500000"
# add &version=1 for the v1 shape (body only)
```

```bash
curl -X POST http://localhost:3002/requirements \
  -H "Content-Type: application/json" \
  -d '{
    "amount": "500000",
    "resource": {
      "url": "https://api.example.com/premium-content",
      "description": "Access to premium content",
      "mimeType": "application/json"
    },
    "extra": { "merchantAddress": "0xMerchantAddress" }
  }'
```

Response:
```json
{
  "x402Version": 2,
  "error": "Payment required",
  "resource": {
    "url": "https://api.example.com/premium-content",
    "description": "Access to premium content",
    "mimeType": "application/json"
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:421614",
      "amount": "500000",
      "asset": "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
      "payTo": "0xFacilitatorAddress",
      "maxTimeoutSeconds": 300,
      "extra": {
        "name": "USD Coin",
        "version": "2",
        "feeBps": 50,
        "gasFee": "100000",
        "merchantAddress": "0xMerchantAddress"
      }
    }
  ]
}
```

`feeBps`, `gasFee`, and `merchantAddress` in `extra` are informational. The merchant that gets paid is always the one tied to the API key used on `/settle`.

### Authenticated Endpoints

**`POST /settle`**

Executes the payment onchain and forwards the merchant share. Requires a merchant API key. The body is the same as `/verify`.

Headers:
```
X-API-Key: your_merchant_api_key_here
```

Response (200):
```json
{
  "success": true,
  "payer": "0xPayerAddress",
  "transaction": "0xPAYER_TRANSFER_TX_HASH",
  "network": "eip155:421614",
  "amount": "500000",
  "extra": {
    "merchantAddress": "0xMerchantAddress",
    "forward": {
      "status": "complete",
      "transaction": "0xFORWARD_TX_HASH"
    },
    "feeBreakdown": {
      "merchantAmount": "398009",
      "serviceFee": "1991",
      "gasFee": "100000",
      "totalAmount": "500000"
    }
  }
}
```

`transaction` is the buyer to facilitator transfer. `extra.forward` describes the facilitator to merchant transfer: `"complete"` means it confirmed, `"pending"` means the buyer's payment landed but forwarding will be retried by the recovery worker.

Failure:
```json
{
  "success": false,
  "errorReason": "invalid_exact_evm_nonce_already_used",
  "payer": "0xPayerAddress",
  "transaction": "",
  "network": "eip155:421614"
}
```

Some failures also include an `errorMessage`. `errorReason: "settlement_pending"` is not terminal: the transaction was broadcast but not confirmed within `SETTLEMENT_CONFIRMATION_TIMEOUT_MS`, and `transaction` holds its hash. Retrying the identical payload with the same merchant key reconciles against that transaction instead of broadcasting a new one.

Authentication failures return 401 (missing or invalid key) or 403 (merchant disabled or pending approval) with `{ "error": "..." }`.

### Error Codes

`invalidReason` (verify) and `errorReason` (settle) use the spec's error codes:

| Code | Meaning |
|------|---------|
| `invalid_payload`, `invalid_payment_requirements`, `invalid_x402_version` | Malformed request |
| `unsupported_payload_type` | Not an EIP-3009 payload (Permit2, ERC-7710) |
| `invalid_network`, `invalid_exact_evm_network_mismatch` | Network is not the one this instance settles on |
| `invalid_exact_evm_scheme` | Scheme is not `exact` |
| `invalid_exact_evm_missing_eip712_domain`, `invalid_exact_evm_token_name_mismatch`, `invalid_exact_evm_token_version_mismatch` | `extra.name` / `extra.version` missing or wrong |
| `invalid_exact_evm_recipient_mismatch` | `payTo` or `authorization.to` is not the facilitator |
| `invalid_exact_evm_signature` | Signature does not verify |
| `invalid_exact_evm_payload_authorization_valid_before`, `invalid_exact_evm_payload_authorization_valid_after` | Authorization expired, expires too soon, or not yet valid |
| `invalid_exact_evm_payload_authorization_value_mismatch` | `authorization.value` differs from `amount` |
| `invalid_exact_evm_nonce_already_used` | Nonce already used |
| `insufficient_funds` | Payer balance too low |
| `invalid_exact_evm_transaction_simulation_failed`, `invalid_exact_evm_transaction_failed`, `invalid_exact_evm_transfer_event_mismatch`, `invalid_transaction_state` | Onchain simulation or execution failed |
| `settlement_pending` | Broadcast but not yet confirmed; retry to reconcile |
| `unexpected_verify_error`, `unexpected_settle_error` | Internal error |

Facilitator-specific codes:

| Code | Meaning |
|------|---------|
| `unsupported_asset` | Asset is not USDC on this network |
| `amount_below_facilitator_fee` | Amount does not cover `GAS_FEE_USDC` |
| `amount_above_facilitator_limit` | Amount exceeds `MAX_SETTLEMENT_AMOUNT` |
| `merchant_not_registered`, `merchant_disabled` | Merchant for this API key cannot receive payments |

### Admin Endpoints

**`GET /admin/wallet`**

Returns the facilitator's USDC and ETH balances. Requires admin API key.

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

## HTTP Payment Flow

Between the buyer and the resource server, x402 v2 uses three headers (see the spec's [HTTP transport](https://github.com/x402-foundation/x402/blob/main/specs/transports-v2/http.md)):

1. The resource server replies `402 Payment Required` with a base64-encoded `PaymentRequired` in the `PAYMENT-REQUIRED` header.
2. The client signs an EIP-3009 authorization and retries with a base64-encoded `PaymentPayload` in the `PAYMENT-SIGNATURE` header.
3. The resource server calls the facilitator's `/verify` and `/settle`, then returns the content with a base64-encoded `SettleResponse` in the `PAYMENT-RESPONSE` header.

x402 v1 used `X-PAYMENT` and `X-PAYMENT-RESPONSE` instead. The facilitator itself never reads these headers; they only travel between the buyer and the resource server. Use the official SDKs rather than encoding them by hand.

## Fee Model

### How Fees Work

The facilitator collects two types of fees:

1. **Service Fee**: Percentage of merchant amount (default 0.5%)
2. **Gas Fee**: Fixed USDC amount to cover transaction costs (default 0.1 USDC)

The price a resource server charges is the gross amount the buyer pays. It must be at least `GAS_FEE_USDC`.

### Payment Flow

```
Buyer signs an authorization for the total amount, payTo = facilitator
  |
  v
Facilitator runs transferWithAuthorization to itself
  |
  +---> Forwards merchant amount to the merchant tied to the API key
  |
  +---> Keeps service fee + gas fee
```

### Example Calculation

The facilitator splits the gross amount so that `total = merchant + merchant * SERVICE_FEE_BPS / 10000 + GAS_FEE_USDC`. The merchant amount is rounded down and the service fee is the remainder, so the three parts always sum exactly to the total.

For a 1 USDC merchant payment:

```
Merchant Amount:  1.000000 USDC  (goes to merchant)
Service Fee:      0.005000 USDC  (0.5% of merchant amount)
Gas Fee:          0.100000 USDC  (fixed)
-----------------------------------------
Total User Pays:  1.105000 USDC
```

For a `$0.50` price (`500000`), the merchant receives `398009`, the service fee is `1991`, and the gas fee is `100000`.

### Fee Configuration

```env
SERVICE_FEE_BPS=50        # 50 basis points = 0.5%
GAS_FEE_USDC=100000       # 0.1 USDC (6 decimals)
```

## Network Support

Each facilitator instance settles on exactly one network, selected by `NETWORK`. Run one instance per network.

### Arbitrum One (Mainnet)

- **Network**: `eip155:42161` (legacy name `arbitrum`)
- **Chain ID**: 42161
- **USDC**: `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` (native USDC)
- **EIP-712 domain**: name `USD Coin`, version `2`
- **RPC**: `https://arb1.arbitrum.io/rpc`

### Arbitrum Sepolia (Testnet)

- **Network**: `eip155:421614` (legacy name `arbitrum-sepolia`)
- **Chain ID**: 421614
- **USDC**: `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` (test USDC)
- **EIP-712 domain**: name `USD Coin`, version `2`
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
- EIP-3009 signature verification against the USDC EIP-712 domain (EOA, EIP-1271, EIP-7702)
- Timing bounds (`validAfter <= now`, `validBefore >= now + 6s`)
- Nonce uniqueness (PostgreSQL advisory locks plus onchain `authorizationState`)
- Network, asset, and `payTo` matching
- Amount validation (exact match, gas fee floor, `MAX_SETTLEMENT_AMOUNT` ceiling)
- Balance check and transaction simulation
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

The merchant address registered here is where your share is forwarded. You never put it in `payTo`.

### Protecting Routes (Resource Server)

Use the official x402 middleware with `HTTPFacilitatorClient` pointed at this facilitator. Send the API key only on `/settle`, and use the facilitator's signer address from `/supported` as `payTo`. The full runnable version is in [`x402-examples/basic-express`](x402-examples/basic-express/).

```javascript
import express from 'express';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { HTTPFacilitatorClient } from '@x402/core/server';

const FACILITATOR_URL = process.env.FACILITATOR_URL;
const NETWORK = 'eip155:421614';

const facilitatorClient = new HTTPFacilitatorClient({
  url: FACILITATOR_URL,
  // Per-endpoint headers object is required; only /settle needs the key
  createAuthHeaders: async () => ({
    verify: {},
    settle: { 'X-API-Key': process.env.MERCHANT_API_KEY },
    supported: {},
  }),
});

const resourceServer = new x402ResourceServer(facilitatorClient).register(NETWORK, new ExactEvmScheme());

// payTo is the facilitator's signer address (fee split model)
const supported = await fetch(`${FACILITATOR_URL}/supported`).then((r) => r.json());
const payTo = supported.signers['eip155:*'][0];

const app = express();

app.use(
  paymentMiddleware(
    {
      'GET /api/premium-content': {
        accepts: { scheme: 'exact', price: '$0.50', network: NETWORK, payTo },
        description: 'Access to premium content',
        mimeType: 'application/json',
      },
    },
    resourceServer,
  ),
);

app.get('/api/premium-content', (req, res) => res.json({ data: 'premium' }));
```

For Next.js, `@x402/next` exposes `withX402` and `paymentProxy` with the same resource server setup (see [`x402-examples/nextjs-app`](x402-examples/nextjs-app/)).

### Paying (Client)

Buyers use `@x402/fetch` (or `@x402/axios`), which handles the 402, signs the authorization, and retries with `PAYMENT-SIGNATURE`:

```javascript
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm';
import { privateKeyToAccount } from 'viem/accounts';

const account = privateKeyToAccount(process.env.PAYER_PRIVATE_KEY);
const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: 'eip155:421614', client: new ExactEvmScheme(account) }],
});

const response = await fetchWithPayment('http://localhost:3000/api/premium-content');
const header = response.headers.get('PAYMENT-RESPONSE');
if (header) {
  const settlement = decodePaymentResponseHeader(header);
  console.log(settlement.transaction, settlement.extra?.feeBreakdown);
}
```

### Calling the Facilitator Directly

If you are not using the SDK, call `/verify` and `/settle` with the spec body:

```typescript
const response = await fetch('https://facilitator.example.com/settle', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': 'your_merchant_api_key_here',
  },
  body: JSON.stringify({
    x402Version: 2,
    paymentPayload,       // decoded from the buyer's PAYMENT-SIGNATURE header
    paymentRequirements,  // the entry from accepts[] the buyer chose
  }),
});

const result = await response.json();
if (result.success) {
  console.log('Payment tx:', result.transaction);
  console.log('Merchant received:', result.extra.feeBreakdown.merchantAmount);
  console.log('Forward:', result.extra.forward.status);
} else if (result.errorReason === 'settlement_pending') {
  // Retry the same payload with the same key to reconcile
}
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
