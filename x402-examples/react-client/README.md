# React Client Example

A React frontend demonstrating client-side x402 payment integration.

## Features

- React 18 with hooks
- Wallet connection with wagmi
- EIP-3009 signature creation
- Payment flow UI
- TypeScript support

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment:
```bash
cp .env.example .env
```

Edit `.env`:
```env
VITE_BACKEND_URL=http://localhost:3000
```

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

## Usage

1. Connect your wallet (MetaMask)
2. Approve USDC spending
3. Click "Pay with USDC"
4. Sign the authorization
5. Payment is processed automatically

## Integration Points

This example shows how to:
- Create EIP-3009 signatures on the client
- Send payment payloads to your backend
- Handle payment confirmations
- Display transaction status

## Backend Required

This client requires a backend server (like the Express or Next.js examples) to:
- Return 402 responses with payment requirements
- Settle payments with the facilitator
- Return protected content after payment

## Learn More

- [React Documentation](https://react.dev)
- [wagmi Documentation](https://wagmi.sh)
- [viem Documentation](https://viem.sh)
