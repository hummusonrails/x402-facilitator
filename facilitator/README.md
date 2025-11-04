# X402 Facilitator for Arbitrum

Production-ready x402 payment facilitator service for Arbitrum networks. Supports both Arbitrum One (mainnet) and Arbitrum Sepolia (testnet) with native USDC settlement using EIP-3009 transfer authorizations.

## Features

- **Multi-network support**: Arbitrum One and Arbitrum Sepolia
- **EIP-3009 verification**: Full signature verification for transfer authorizations
- **Strict validation**: Network, token, recipient, amount, and timing checks
- **Idempotency**: Nonce tracking to prevent replay attacks
- **Production-ready**: Structured logging, health checks, error handling
- **Type-safe**: Full TypeScript implementation with Zod validation

## API Endpoints

### `GET /health`
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "network": "arbitrum-sepolia",
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

### `POST /verify`
Verifies a payment payload without executing settlement.

**Request:**
```json
{
  "paymentPayload": {
    "scheme": "exact",
    "network": "arbitrum-sepolia",
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
    "network": "arbitrum-sepolia",
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
Verifies and executes onchain settlement.

**Request:** Same as `/verify`

**Response:**
```json
{
  "success": true,
  "transactionHash": "0x...",
  "blockNumber": 12345678,
  "status": "confirmed"
}
```

Or on error:
```json
{
  "success": false,
  "error": "Settlement failed: insufficient allowance"
}
```

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
# Network: arbitrum or arbitrum-sepolia
NETWORK=arbitrum-sepolia

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
- **Network**: `arbitrum`
- **Chain ID**: 42161
- **USDC**: `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` (native USDC)
- **RPC**: `https://arb1.arbitrum.io/rpc`

### Arbitrum Sepolia (Testnet)
- **Network**: `arbitrum-sepolia`
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

## License

MIT
