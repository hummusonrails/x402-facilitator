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
- **Bazaar discovery (opt in)**: implements the [`bazaar` extension](https://docs.x402.org/extensions/bazaar) when `DISCOVERY_ENABLED=true`. Declarations echoed in `paymentPayload.extensions.bazaar` are validated and, once the payment confirms onchain, indexed and served from `GET /discovery/resources`

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
  "extensions": [],
  "signers": {
    "eip155:*": ["0xFacilitatorAddress"]
  }
}
```

`extensions` lists `bazaar` only when `DISCOVERY_ENABLED=true` and `DATABASE_URL` is set. Without a database there is no catalog to index into, so the facilitator does not advertise the extension.

### `GET /discovery/resources`
Only served when `DISCOVERY_ENABLED=true`; otherwise the route does not exist (404). Bazaar catalog of resources that have settled through this facilitator with a valid `bazaar` declaration. Public, no auth. Same shape as the reference facilitator so `withBazaar(new HTTPFacilitatorClient(...)).extensions.bazaar.listResources()` works unchanged.

Query parameters, all optional: `type` (`http` | `mcp`), `payTo`, `scheme`, `network`, `limit` (1 to 100, default 20), `offset` (default 0). Under the fee-split model `payTo` is always the facilitator address, so it does not filter by seller.

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
      "description": "Example paid analysis endpoint",
      "mimeType": "application/json",
      "serviceName": "Example Analytics API",
      "tags": ["example"],
      "extensions": { "bazaar": { "info": { "input": { "type": "http", "method": "GET", "queryParams": { "address": "0x..." } }, "output": { "type": "json", "example": {} } }, "schema": {} } }
    }
  ],
  "pagination": { "limit": 20, "offset": 0, "total": 1 }
}
```

A resource is indexed only when `/settle` confirms the payer's transfer onchain; declarations attached to payments that never land are never listed. Entries are keyed on `(resource, toolName)` so MCP endpoints get one entry per tool. The first merchant to index a key owns it: settlements by other merchants for the same key are reported as `rejected` (`resource claimed by another merchant`) and change nothing. There is no in-protocol release, so a URL claimed by the wrong merchant needs an operator: disable that merchant first (`pnpm merchants disable <address>`, effective within a minute), then `pnpm discovery delete <url> [toolName]`. Deleting alone lets them reclaim it on their next settlement. `pnpm discovery list` shows entries and their owners. `accepts` holds the requirement from the most recent confirmed settlement, replaced rather than accumulated, so the catalog never advertises superseded terms.

The catalog records that a declaration accompanied a confirmed payment. It does not verify that the declaring party controls the URL; see `../docs/BAZAAR_DISCOVERY.md`.

**This endpoint needs migration 006.** `migrations/` is mounted into `docker-entrypoint-initdb.d`, which Postgres runs only when it initializes an empty data directory, so an existing database will not pick it up on deploy. Apply it once:

```bash
pnpm migrate migrations/006_discovery_resources.sql
```

The migration is idempotent, so re-running it is harmless. Until it is applied, `/settle` still settles payments normally (indexing failures never fail a payment) and `GET /discovery/resources` returns 503.

#### `EXTENSION-RESPONSES` header
When a request carries a `bazaar` declaration, `/verify` and `/settle` add the facilitator-to-server sidechannel header defined in spec section 7.2.1: base64 JSON keyed by extension name. For `bazaar` it holds `status` (`success` once indexed, `processing` while the payment is unconfirmed or indexing is deferred, `rejected` when the declaration was dropped or the key belongs to another merchant) and `rejectedReason` on rejection. A rejected declaration never fails the payment. The header is absent when no declaration was sent.

On `/settle` the verdict is tied to the payment. Validation starts alongside the settlement rather than before it, so the payment never waits on the validator, and the verdict is read once the payer's transfer confirms, waiting at most `DISCOVERY_SCHEMA_TIMEOUT_MS`. If it is in by then (the normal case) it is reported as is; if not, the status is `processing`. When the payment fails `/settle` sends no `bazaar` status, even for a malformed declaration, and while it is pending (`settlement_pending`) the status is `processing`.

On `/verify` the declaration is evaluated only once the payment itself verifies. Validating a declaration means compiling and running a JSON Schema the caller supplied, and `/verify` is unauthenticated, so an unsigned payload gets no header and buys no schema work.

#### Declaration hardening
The declaration reaching `/verify` and `/settle` is attacker-controlled on both halves: the client supplies `schema` and the `info` it is checked against. Three things bound what that can cost:

- **Schema validation runs in a worker thread under a hard timeout** (`DISCOVERY_SCHEMA_TIMEOUT_MS`, default 250ms). Ajv compiles a schema `pattern` to a plain `RegExp` with no linear-time guarantee, so a declaration like `{"pattern": "^(a+)+$"}` matched against `"aaaa…b"` backtracks exponentially. On the main thread that blocks the event loop for the whole process. A validation that overruns has its worker killed and the declaration is reported `processing`, not `rejected`: a slow match can mean a hostile regex or simply a busy box, and the facilitator cannot tell which, so it makes no claim about the declaration. Nothing is indexed either way.
- **Declarations over `DISCOVERY_MAX_DECLARATION_BYTES`** (default 16KB) are refused before any schema work.
- **Resource URLs are screened** before they enter the catalog: loopback names, IPv4 literals, decimal- and hex-encoded hosts, IPv6 literals, internal-use suffixes and bare hostnames are all refused, as are URLs carrying credentials. A catalogued URL is one that agents call unattended, so the catalog must not be able to point them at `http://169.254.169.254/` or back at a private network. Set `DISCOVERY_ALLOW_PRIVATE_RESOURCE_URLS=true` to develop against a seller on localhost. The same screen, including its 2048-character limit, is applied again to the URL that is actually stored (origin + the declaration's `routeTemplate`).

`DISCOVERY_SCHEMA_TIMEOUT_MS` (minimum 1) and `DISCOVERY_MAX_DECLARATION_BYTES` (minimum 1024) are validated at startup; the process refuses to boot on a non-numeric or too-small value.

#### Known limitations
- **A deferred declaration is never indexed.** If the schema validator is saturated or times out, the header says `processing`, the payment still settles, and the declaration is dropped: nothing persists it and nothing retries it. It is only catalogued if a later settlement carries it again.
- **`/verify` and `/settle` share one schema validation queue.** `/verify` is unauthenticated and does not consume the nonce, so a replayed payload with a slow schema can fill the queue and push declarations on real settlements onto the deferred path above. The settlements themselves are not delayed.

Details in [`../docs/BAZAAR_DISCOVERY.md`](../docs/BAZAAR_DISCOVERY.md#known-limitations).

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

# Optional: Bazaar discovery. Off unless set to true; needs DATABASE_URL and migration 006
DISCOVERY_ENABLED=false
# Bazaar discovery hardening (only used when discovery is enabled)
# Hard timeout for the worker that validates a declaration's JSON Schema (default: 250)
DISCOVERY_SCHEMA_TIMEOUT_MS=250
# Largest bazaar declaration accepted, in bytes (default: 16384)
DISCOVERY_MAX_DECLARATION_BYTES=16384
# Allow loopback / private resource URLs into the catalog. Local development only (default: false)
DISCOVERY_ALLOW_PRIVATE_RESOURCE_URLS=false

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
│   ├── schemaGuard.ts   # Runs declaration JSON Schema validation in a worker under a timeout
│   ├── resourceUrl.ts   # SSRF screening for declared resource URLs
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
