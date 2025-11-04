# Next.js Integration Example

A full-stack Next.js application with x402 payment integration.

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
FACILITATOR_URL=http://localhost:3002
MERCHANT_API_KEY=your_api_key_here
MERCHANT_ADDRESS=0xYourMerchantAddress
NEXT_PUBLIC_FACILITATOR_ADDRESS=0xFacilitatorAddress
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
2. Client creates EIP-3009 signature using MetaMask
3. Client sends payment to backend API route
4. Backend settles payment with facilitator
5. Content is unlocked for user

## Testing

1. Connect MetaMask to Arbitrum Sepolia
2. Get test USDC from faucet
3. Approve USDC spending
4. Click payment button
5. Sign the EIP-3009 authorization
6. View unlocked content

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [viem Documentation](https://viem.sh)
- [X402 Integration Guide](../../docs/INTEGRATION_GUIDE.md)
