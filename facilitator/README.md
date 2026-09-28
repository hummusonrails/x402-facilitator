# X402 Facilitator for Arbitrum

x402 payment facilitator for Arbitrum, aligned with the [x402 v2 specification](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md). It verifies and settles `exact` scheme payments in native USDC using EIP-3009 `transferWithAuthorization`, and works with the official `@x402/*` SDKs (for example `HTTPFacilitatorClient` in `@x402/core`).

## Features

- **Spec facilitator API**: `POST /verify`, `POST /settle`, and `GET /supported` use the v2 request and response shapes; v1 payloads are still accepted
- **CAIP-2 network IDs**: `eip155:42161` and `eip155:421614`, with legacy aliases accepted
- **Spec verification rules**: exact amount match, validity window (6 second buffer), balance check, onchain nonce check, and transfer simulation
- **Strict signatures**: mirrors USDC's onchain `SignatureChecker` (ecrecover for EOAs, EIP-1271 for smart wallets and EIP-7702 delegated EOAs)
- **Read-only verify**: `/verify` writes nothing, so verify then settle works as the spec intends
- **`settlement_pending` support**: retrying an unconfirmed settlement reconciles against the broadcast transaction instead of sending a new one
- **Fee split**: the facilitator is `payTo`, takes a service and gas fee, and forwards the rest to the merchant tied to the API key
- **Bazaar discovery**: implements the [`bazaar` extension](https://docs.x402.org/extensions/bazaar). Declarations echoed in `paymentPayload.extensions.bazaar` are validated and, once the payment confirms onchain, indexed and served from `GET /discovery/resources`

## How payment flows

1. The resource server returns HTTP 402 with a `PAYMENT-REQUIRED` header whose `payTo` is the facilitator address (read it from `GET /supported` under `signers["eip155:*"]`).
2. The buyer signs an EIP-3009 authorization and retries with `PAYMENT-SIGNATURE`.
3. The resource server calls `POST /verify`, runs its handler, then calls `POST /settle` with its merchant `X-API-Key`.
4. The facilitator submits `transferWithAuthorization` (buyer to facilitator), then transfers the merchant share to the merchant address.

The fee is `total = merchant + merchant * SERVICE_FEE_BPS / 10000 + GAS_FEE_USDC`. The service fee is taken as the residual so the parts always sum to the amount paid. The amount must cover `GAS_FEE_USDC`.

Each instance settles on the single network set by `NETWORK`. Only the `eip3009` asset transfer method (the spec default for exact EVM) is supported.

## API Endpoints

### `GET /health`
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "network": "eip155:421614",
  "chainId": 421614,
  "timestamp": 1699000000000
}
```

### `GET /supported`
Returns the supported payment kinds and the facilitator signer, which is also the required `payTo`.

**Response:**
```json
{
  "kinds": [
    { "x402Version": 2, "scheme": "exact", "network": "eip155:421614" },
    { "x402Version": 1, "scheme": "exact", "network": "arbitrum-sepolia" }
  ],
  "extensions": ["bazaar"],
  "signers": {
    "eip155:*": ["0xFacilitatorAddress"]
  }
}
```

### `GET /discovery/resources`
Bazaar catalog of resources that have settled through this facilitator with a valid `bazaar` declaration. Public, no auth. Same shape as the reference facilitator so `withBazaar(new HTTPFacilitatorClient(...)).extensions.bazaar.listResources()` works unchanged.

Query parameters, all optional: `type` (`http` | `mcp`), `payTo`, `scheme`, `network`, `limit` (1 to 100, default 20), `offset` (default 0).

**Response:**
```json
{
  "x402Version": 2,
  "items": [
    {
      "resource": "https://api.example.com/analyze",
      "type": "http",
      "x402Version": 2,
      "accepts": [{ "scheme": "exact", "network": "eip155:421614", "amount": "250000", "asset": "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", "payTo": "0xFacilitatorAddress", "maxTimeoutSeconds": 300, "extra": { "name": "USD Coin", "version": "2" } }],
      "lastUpdated": "2026-09-29T09:00:00.000Z",
      "description": "Risk analysis of an Arbitrum One contract",
      "mimeType": "application/json",
      "serviceName": "Nota Contract Intel",
      "tags": ["arbitrum", "security"],
      "extensions": { "bazaar": { "info": { "input": { "type": "http", "method": "GET", "queryParams": { "address": "0x..." } }, "output": { "type": "json", "example": {} } }, "schema": {} } }
    }
  ],
  "pagination": { "limit": 20, "offset": 0, "total": 1 }
}
```

A resource is indexed only when `/settle` confirms the payer's transfer onchain; declarations attached to payments that never land are never listed. Entries are keyed on `(resource, toolName)` so MCP endpoints get one entry per tool.

#### `EXTENSION-RESPONSES` header
When a request carries a `bazaar` declaration, `/verify` and `/settle` add the facilitator-to-server sidechannel header defined in spec section 7.2.1: base64 JSON keyed by extension name. For `bazaar` it holds `status` (`success` once indexed, `processing` while the payment is unconfirmed, `rejected` when the declaration was dropped) and `rejectedReason` on rejection. A rejected declaration never fails the payment. The header is absent when no declaration was sent.

### `POST /verify`
Verifies a payment without settling it. Read-only.

**Request:**
```json
{
  "x402Version": 2,
  "paymentPayload": {
    "x402Version": 2,
    "resource": { "url": "https://api.example.com/premium", "mimeType": "application/json" },
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
      "signature": "0x...",
      "authorization": {
        "from": "0xBuyer",
        "to": "0xFacilitatorAddress",
        "value": "500000",
        "validAfter": "1740672089",
        "validBefore": "1740672389",
        "nonce": "0x..."
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

**Response (200):**
```json
{ "isValid": true, "payer": "0xBuyer" }
```

```json
{ "isValid": false, "invalidReason": "insufficient_funds", "payer": "0xBuyer" }
```

A malformed request returns 400 with `isValid: false` and `invalidReason` set to `invalid_payload`, `invalid_payment_requirements`, `invalid_x402_version`, or `unsupported_payload_type`.

### `POST /settle`
Verifies again, then settles onchain and forwards the merchant share.

**Authentication:** Requires the merchant `X-API-Key` header.

**Request:** Same as `/verify`.

**Response (200):**
```json
{
  "success": true,
  "payer": "0xBuyer",
  "transaction": "0x...",
  "network": "eip155:421614",
  "amount": "500000",
  "extra": {
    "merchantAddress": "0xMerchant",
    "forward": { "status": "complete", "transaction": "0x..." },
    "feeBreakdown": {
      "merchantAmount": "398009",
      "serviceFee": "1991",
      "gasFee": "100000",
      "totalAmount": "500000"
    }
  }
}
```

`transaction` is the buyer's `transferWithAuthorization`. `extra.forward.status` is `pending` if the payment landed but forwarding to the merchant has not confirmed yet; the recovery worker retries it.

**Failure:**
```json
{
  "success": false,
  "errorReason": "invalid_exact_evm_nonce_already_used",
  "payer": "0xBuyer",
  "transaction": "",
  "network": "eip155:421614"
}
```

`settlement_pending` is non-terminal: the transaction was broadcast but not confirmed within `SETTLEMENT_CONFIRMATION_TIMEOUT_MS`, and `transaction` holds its hash. Retrying the same payload with the same merchant key reconciles against that transaction.

### Error reasons

Protocol codes from the spec: `insufficient_funds`, `invalid_network`, `invalid_payload`, `invalid_payment_requirements`, `invalid_x402_version`, `invalid_transaction_state`, `unexpected_verify_error`, `unexpected_settle_error`, `settlement_pending`.

Exact EVM codes, matching the reference facilitator: `invalid_exact_evm_scheme`, `invalid_exact_evm_network_mismatch`, `invalid_exact_evm_missing_eip712_domain`, `invalid_exact_evm_recipient_mismatch`, `invalid_exact_evm_signature`, `invalid_exact_evm_payload_authorization_valid_before`, `invalid_exact_evm_payload_authorization_valid_after`, `invalid_exact_evm_payload_authorization_value_mismatch`, `invalid_exact_evm_token_name_mismatch`, `invalid_exact_evm_token_version_mismatch`, `invalid_exact_evm_nonce_already_used`, `invalid_exact_evm_transaction_simulation_failed`, `invalid_exact_evm_transaction_failed`, `invalid_exact_evm_transfer_event_mismatch`, `unsupported_payload_type`.

Facilitator specific: `unsupported_asset`, `amount_below_facilitator_fee`, `amount_above_facilitator_limit`, `merchant_not_registered`, `merchant_disabled`.

### `GET /requirements` / `POST /requirements`
Helper that builds a `PaymentRequired` object for this facilitator. Returns 200 with the object in the body and base64 encoded in the `PAYMENT-REQUIRED` header. Pass `version=1` (query) or `"x402Version": 1` (body) for the legacy v1 shape.

`GET /requirements?amount=500000` or `POST /requirements` with:
```json
{
  "amount": "500000",
  "resource": { "url": "https://api.example.com/premium", "description": "Premium data", "mimeType": "application/json" }
}
```

**Response:**
```json
{
  "x402Version": 2,
  "error": "Payment required",
  "resource": { "url": "https://api.example.com/premium", "description": "Premium data", "mimeType": "application/json" },
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:421614",
      "amount": "500000",
      "asset": "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
      "payTo": "0xFacilitatorAddress",
      "maxTimeoutSeconds": 300,
      "extra": { "name": "USD Coin", "version": "2", "feeBps": 50, "gasFee": "100000" }
    }
  ]
}
```

### `GET /admin/wallet` (Admin Only)
Returns facilitator wallet balance and address.

**Authentication:** Requires `X-Admin-Key` header

**Response:**
```json
{
  "balance": "1234567890",
  "ethBalance": "500000000000000000",
  "address": "0x0000000000000000000000000000000000000000"
}
```

- `balance`: USDC balance in base units (6 decimals)
- `ethBalance`: ETH balance in wei (18 decimals)

## Setup

### Prerequisites

- Node.js 20+
- PostgreSQL 14+ (for persistent nonce storage)
- Private key for the facilitator account
- RPC access to Arbitrum networks

### Installation

```bash
cd facilitator
pnpm install
```

### Configuration

Copy the example environment file and configure:

```bash
cp .env.example .env
```

**Security Warning:** Always change default passwords before running:
- `POSTGRES_PASSWORD` - Set a strong, unique password
- `FACILITATOR_PRIVATE_KEY` - Use your actual private key (never commit to git)

Required environment variables:

```env
# Network: eip155:42161 or eip155:421614 (legacy names arbitrum/arbitrum-sepolia still accepted)
NETWORK=eip155:421614

# Database (REQUIRED for production)
POSTGRES_USER=facilitator
POSTGRES_PASSWORD=your_secure_password_here  # CHANGE THIS
POSTGRES_DB=facilitator
POSTGRES_HOST=localhost
POSTGRES_PORT=5432

# Facilitator private key (pays gas, receives fees)
FACILITATOR_PRIVATE_KEY=0x...

# Optional: Custom RPC URLs
ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc
ARBITRUM_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc

# Optional: Server port (default: 3002)
PORT=3002

# Optional: Max settlement amount in smallest unit (default: 1000 USDC)
MAX_SETTLEMENT_AMOUNT=1000000000

# Optional: How long to wait for a settlement receipt before returning settlement_pending (default: 180000)
SETTLEMENT_CONFIRMATION_TIMEOUT_MS=180000
```

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

## Network Configuration

### Arbitrum One (Mainnet)
- **Network**: `eip155:42161` (alias: `arbitrum`)
- **Chain ID**: 42161
- **USDC**: `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` (native USDC)
- **RPC**: `https://arb1.arbitrum.io/rpc`

### Arbitrum Sepolia (Testnet)
- **Network**: `eip155:421614` (alias: `arbitrum-sepolia`)
- **Chain ID**: 421614
- **USDC**: `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` (test USDC)
- **RPC**: `https://sepolia-rollup.arbitrum.io/rpc`

## Security

- Requests are validated with the canonical `@x402/core` schemas
- Signatures are checked the way USDC checks them onchain, and every settlement is simulated first
- Nonces are claimed atomically in PostgreSQL and checked against onchain `authorizationState`
- Settlement confirms the expected USDC `Transfer` event, not just a successful receipt
- Asset, network, and `payTo` must match this instance's configuration
- Amount limits enforced (default: 1000 USDC max)
- Timing windows validated (validAfter/validBefore)

## Architecture

```
facilitator/
├── src/
│   ├── server.ts        # Express server with API endpoints
│   ├── x402.ts          # Parses and normalizes v1/v2 facilitator requests
│   ├── verify.ts        # Exact EVM (eip3009) verification
│   ├── settle.ts        # Onchain settlement, forwarding, and pending reconciliation
│   ├── requirements.ts  # PaymentRequired helper
│   ├── fees.ts          # Fee split calculation
│   ├── errors.ts        # Error reason codes
│   ├── clients.ts       # viem clients and USDC ABI
│   ├── config.ts        # Network and environment configuration
│   ├── types.ts         # Types (wire types re-exported from @x402/core)
│   ├── bazaar.ts        # Bazaar extension: declaration validation, indexing, EXTENSION-RESPONSES
│   ├── discoveryStore.ts # discovery_resources table access for GET /discovery/resources
│   ├── recovery.ts      # Retries incomplete merchant forwards
│   ├── logging.ts       # Structured logging utilities
│   └── health.ts        # Health check handler
├── package.json
├── tsconfig.json
├── Dockerfile
└── .env.example
```

## Development

**Type checking:**
```bash
pnpm check
```

**Build:**
```bash
pnpm build
```

**Clean:**
```bash
pnpm clean
```

## Migration notes

For a summary of changes and guidance for legacy integrations, see `docs/migration-v2.md`.

## Discovery architecture

Component and sequence diagrams for the Bazaar extension live in [`../docs/BAZAAR_DISCOVERY.md`](../docs/BAZAAR_DISCOVERY.md).

## License

MIT
