# Next.js Integration Example

A Next.js 16 app (App Router, React 19, TypeScript) whose API route is paid with x402 v2 and settled through the Arbitrum facilitator, using `@x402/next` from [x402-foundation/x402](https://github.com/x402-foundation/x402).

## Features

- `withX402` route wrapper from `@x402/next`: verifies before your handler runs and settles only if it returns a status below 400
- `HTTPFacilitatorClient` sending the merchant API key only on `/settle`
- `payTo` read from the facilitator's `GET /supported` on the first paid request, then cached

## Requirements

- Node.js 20.9 or later
- Next.js 16.2.6 or later (required by `@x402/next`)
- A running facilitator and a merchant API key

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
# Must match the facilitator's NETWORK
NETWORK=eip155:421614
```

These are server-only values. Never prefix the API key with `NEXT_PUBLIC_`.

3. Start the app:
```bash
npm run dev
# or: npm run build && npm start
```

## Project Structure

```
nextjs-app/
├── app/
│   ├── api/premium-content/route.ts   # Paid route wrapped with withX402
│   ├── layout.tsx
│   └── page.tsx
├── lib/x402.ts                        # Facilitator client, resource server, payTo lookup
├── next.config.ts
├── tsconfig.json
└── .env.example
```

## Code

### `lib/x402.ts`

```typescript
import { x402ResourceServer } from '@x402/next';
import type { Network } from '@x402/next';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';

const FACILITATOR_URL = process.env.FACILITATOR_URL ?? 'http://localhost:3002';
export const NETWORK = (process.env.NETWORK ?? 'eip155:421614') as Network;

const facilitatorClient = new HTTPFacilitatorClient({
  url: FACILITATOR_URL,
  // Keyed by facilitator endpoint; only /settle needs the merchant API key
  createAuthHeaders: async () => ({
    verify: {},
    settle: { 'X-API-Key': process.env.MERCHANT_API_KEY ?? '' },
    supported: {},
  }),
});

export const server = new x402ResourceServer(facilitatorClient).register(NETWORK, new ExactEvmScheme());
```

The file also exports `facilitatorPayTo()`, which reads `signers["eip155:*"][0]` from `GET /supported` and caches it. Buyers pay that facilitator address, and the facilitator forwards your share to the merchant address tied to your API key.

### `app/api/premium-content/route.ts`

```typescript
import { NextResponse } from 'next/server';
import { withX402 } from '@x402/next';
import { server, NETWORK, facilitatorPayTo } from '@/lib/x402';

async function handler() {
  return NextResponse.json({
    title: 'Premium Content',
    body: 'This is the premium content you paid for!',
    timestamp: new Date().toISOString(),
  });
}

export const GET = withX402(
  handler,
  {
    accepts: {
      scheme: 'exact',
      // Must cover the facilitator's fixed gas fee (0.10 USDC by default)
      price: '$0.50',
      network: NETWORK,
      payTo: facilitatorPayTo,
    },
    description: 'Access to premium content',
    mimeType: 'application/json',
  },
  server,
);
```

To protect pages instead of API routes, use `paymentProxy` from `@x402/next` in `proxy.ts` with the same `server` (see the [`@x402/next` README](https://github.com/x402-foundation/x402/tree/main/typescript/packages/http/next)).

## Usage Flow

1. A client requests `/api/premium-content` without payment
2. `withX402` responds `402` with a base64 `PaymentRequired` in the `PAYMENT-REQUIRED` header (`payTo` is the facilitator, `network` is CAIP-2, for example `eip155:421614`)
3. The client signs an EIP-3009 authorization and retries with `PAYMENT-SIGNATURE` (`@x402/fetch` does this automatically)
4. `withX402` verifies with the facilitator and runs your handler
5. On a successful response it settles with the facilitator using your API key
6. The facilitator receives the funds and forwards your net amount
7. The response carries the settlement result in the `PAYMENT-RESPONSE` header

## Testing

1. Start the facilitator with `NETWORK=eip155:421614`
2. Run `npm run dev`
3. `curl -i http://localhost:3000/api/premium-content` returns 402 with `PAYMENT-REQUIRED`
4. Pay with the `basic-express` example's client: `RESOURCE_URL=http://localhost:3000/api/premium-content npm run client`

`withX402` fetches the facilitator's supported kinds when the route loads. If the facilitator is unreachable at that moment (including during `next build`), it logs `Failed to fetch supported kinds from facilitator` and paid requests return 500 until the facilitator is reachable; it recovers on its own without a restart.

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [`@x402/next` README](https://github.com/x402-foundation/x402/tree/main/typescript/packages/http/next)
- [X402 Integration Guide](../../docs/INTEGRATION_GUIDE.md)
