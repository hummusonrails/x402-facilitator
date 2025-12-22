# Next.js Integration Example

A full-stack Next.js application with x402 payment integration (CAIP-2 networks, header-based requirements).

## Features

- Next.js 14 with App Router
- Client-side payment creation with viem
- Server-side payment settlement
- TypeScript support
- Tailwind CSS styling

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables:
```bash
cp .env.example .env.local
```

Edit `.env.local`:
```env
NEXT_PUBLIC_FACILITATOR_URL=http://localhost:3002
MERCHANT_API_KEY=your_api_key_here
MERCHANT_ADDRESS=0xYourMerchantAddress
# Optional: private key for local testing with @x402 clients
# NEXT_PUBLIC_EVM_PRIVATE_KEY=0x...
```

3. Start development server:
```bash
npm run dev
```

## Project Structure

```
nextjs-app/
├── app/
│   ├── api/
│   │   └── settle/
│   │       └── route.ts      # Settlement API route
│   ├── page.tsx              # Home page with payment demo
│   └── layout.tsx
├── components/
│   └── PaymentButton.tsx    # Payment component
├── lib/
│   └── payment.ts            # Payment utilities
└── package.json
```

## Usage Flow

1. User clicks "Purchase Content"
2. Client fetches payment requirements from facilitator (POST /requirements) and reads them from the `PAYMENT-RESPONSE` header (mirrored to `X-PAYMENT-RESPONSE` for legacy tools)
3. Facilitator issues requirements with its own address as `payTo` and CAIP-2 `network` (e.g., `eip155:421614`)
4. Client creates EIP-3009 signature using MetaMask
5. Client sends signed payload to backend API route (body or `PAYMENT-SIGNATURE` header)
6. Backend verifies and settles payment with facilitator
7. Facilitator receives funds, forwards merchant net amount
8. Content is unlocked for user

## Integration Pattern

This example demonstrates x402 integration where:
- Client only needs facilitator URL
- Facilitator address provided dynamically
- Requirements fetched from the facilitator
- Fee model enforced server-side

## Testing

1. Connect MetaMask to Arbitrum Sepolia (`eip155:421614`)
2. Get test USDC from faucet
3. Approve USDC spending
4. Click payment button
5. Sign the EIP-3009 authorization
6. View unlocked content

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [viem Documentation](https://viem.sh)
- [X402 Integration Guide](../../docs/INTEGRATION_GUIDE.md)
