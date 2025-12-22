# X402 Facilitator for Arbitrum

Production-ready x402 payment facilitator service for Arbitrum networks with CAIP-2 identifiers and native USDC settlement using EIP-3009 transfer authorizations.

## Features

- **CAIP-2 network IDs**: Uses `eip155:42161` and `eip155:421614` with legacy aliases accepted
- **EIP-3009 verification**: Full signature verification for transfer authorizations
- **Strict validation**: Network, token, recipient, amount, and timing checks
- **Idempotency**: Nonce tracking to prevent replay attacks
- **Production-ready**: Structured logging, health checks, error handling
- **Header-friendly paywall**: Requirements emitted in `PAYMENT-RESPONSE` (and mirrored to `X-PAYMENT-RESPONSE` for older clients)

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
Returns supported payment kinds.

**Response:**
```json
{
  "kinds": [
    { "x402Version": 1, "scheme": "exact", "network": "arbitrum" },
    { "x402Version": 1, "scheme": "exact", "network": "arbitrum-sepolia" },
    { "x402Version": 2, "scheme": "exact", "network": "eip155:42161", "payTo": "0x..." },
    { "x402Version": 2, "scheme": "exact", "network": "eip155:421614", "payTo": "0x..." }
  ],
  "versions": {
    "1": { "kinds": [{ "x402Version": 1, "scheme": "exact", "network": "arbitrum" }, { "x402Version": 1, "scheme": "exact", "network": "arbitrum-sepolia" }] },
    "2": { "kinds": [{ "x402Version": 2, "scheme": "exact", "network": "eip155:42161", "payTo": "0x..." }, { "x402Version": 2, "scheme": "exact", "network": "eip155:421614", "payTo": "0x..." }] }
  },
  "signingAddresses": {
    "settlement": "0x..."
  },
  "extensions": []
}
```

### `GET /requirements` / `POST /requirements`
Returns payment requirements for the configured network. Defaults to the latest shape; pass `version=1` (query string) or `{"x402Version":1}` in the body for the legacy structure.

**Headers:**
- `PAYMENT-RESPONSE`: JSON string of the requirements (mirrored to `X-PAYMENT-RESPONSE` for older clients)

**Response body (default):**
```json
{
  "x402Version": 2,
  "error": "Payment required",
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:421614",
      "maxAmountRequired": "1000000",
      "asset": "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
      "payTo": "0x...",
      "resource": "http://localhost:3002/resource",
      "description": "Payment required for resource access",
      "mimeType": "application/json",
      "maxTimeoutSeconds": 3600,
      "extra": {
        "feeMode": "facilitator_split",
        "feeBps": 50,
        "gasBufferWei": "100000",
        "nonce": "0x...",
        "deadline": 1735689600
      }
    }
  ]
}
```

### `POST /verify`
Verifies a payment payload without executing settlement. The payload can be provided in the request body or as JSON in the `PAYMENT-SIGNATURE` header.

**Request:**
```json
{
  "paymentPayload": {
    "scheme": "exact",
    "network": "eip155:421614",
    "payload": {
      "from": "0x...",
      "to": "0x...",
      "value": "1000000",
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
    "network": "eip155:421614",
    "token": "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    "amount": "1000000",
    "recipient": "0x...",
    "description": "Payment for service",
    "maxTimeoutSeconds": 300
  }
}
```

**Response:**
```json
{
  "valid": true
}
```

Or on error:
```json
{
  "valid": false,
  "invalidReason": "Invalid signature"
}
```

### `POST /settle`
Verifies and executes onchain settlement. The payload can be provided in the request body or as JSON in the `PAYMENT-SIGNATURE` header.

**Request:** Same as `/verify`

**Response:**
```json
{
  "success": true,
  "transactionHash": "0x...",
  "blockNumber": 12345678,
  "status": "confirmed",
  "feeBreakdown": {
    "merchantAmount": "1000000",
    "serviceFee": "5000",
    "gasFee": "100000",
    "totalAmount": "1105000"
  }
}
```

Or on error:
```json
{
  "success": false,
  "error": "Settlement failed: insufficient allowance"
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

- All payment parameters are strictly validated
- EIP-3009 signatures are cryptographically verified
- Nonce tracking prevents replay attacks
- Recipient and token addresses must match configuration
- Amount limits enforced (default: 1000 USDC max)
- Timing windows validated (validAfter/validBefore)

## Architecture

```
facilitator/
├── src/
│   ├── server.ts      # Express server with API endpoints
│   ├── config.ts      # Network and environment configuration
│   ├── types.ts       # TypeScript types and Zod schemas
│   ├── verify.ts      # Payment verification logic
│   ├── settle.ts      # onchain settlement execution
│   ├── eip3009.ts     # EIP-3009 signature verification
│   ├── logging.ts     # Structured logging utilities
│   └── health.ts      # Health check handler
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

## License

MIT
