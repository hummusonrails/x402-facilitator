# React Client Example

A React client demonstrating x402 payment flow with CAIP-2 networks and header-based requirements.

## Features

- React hooks for x402 payment handling
- Dynamic requirements fetching from facilitator
- MetaMask integration
- EIP-3009 permit signature creation
- Payment status tracking
- TypeScript support

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment:
```bash
cp .env.example .env.local
```

Edit `.env.local`:
```env
REACT_APP_FACILITATOR_URL=http://localhost:3002
REACT_APP_BACKEND_URL=http://localhost:3000
# Optional: EVM private key for local testing with @x402 clients
# REACT_APP_EVM_PRIVATE_KEY=0x...
```

Note: Only the facilitator URL is needed. The facilitator address is never required in client configuration.

3. Start development server:
```bash
npm run dev
```

## Features Demonstrated

- Wallet connection
- USDC approval flow
- EIP-3009 signature creation
- Payment submission
- Transaction status tracking

## Usage Flow

1. Connect browser wallet to Arbitrum Sepolia (`eip155:421614`)
2. Request protected content from your backend
3. Backend returns facilitator URL and payment details
4. Client fetches requirements from facilitator (POST /requirements) and reads them from the `PAYMENT-RESPONSE` header (mirrored to `X-PAYMENT-RESPONSE`)
5. Client creates EIP-3009 permit using requirements.recipient/payTo
6. Client signs permit with MetaMask
7. Client submits signed payload to backend (body or `PAYMENT-SIGNATURE` header)
8. Backend settles with facilitator
9. Content is unlocked

## Integration Points

This example shows how to:
- Create EIP-3009 signatures on the client
- Send payment payloads to your backend
- Handle payment confirmations
- Display transaction status

## Backend Required

This client requires a backend server (like the Express or Next.js examples) to:
- Return 402 responses with payment requirements (set `PAYMENT-RESPONSE` / `X-PAYMENT-RESPONSE` headers)
- Settle payments with the facilitator
- Return protected content after payment

## Learn More

- [React Documentation](https://react.dev)
- [wagmi Documentation](https://wagmi.sh)
- [viem Documentation](https://viem.sh)
