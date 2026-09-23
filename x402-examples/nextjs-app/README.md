# Next.js Integration Example

How to protect a Next.js API route with x402 v2 payments settled through the Arbitrum facilitator, using `@x402/next` from [x402-foundation/x402](https://github.com/x402-foundation/x402).

This directory contains the `package.json` and this guide. Copy the snippets below into your own Next.js app.

## Features

- `withX402` route wrapper from `@x402/next` (settles only after your handler succeeds)
- `HTTPFacilitatorClient` sending the merchant API key only on `/settle`
- `payTo` resolved at request time from the facilitator's `GET /supported`
- TypeScript

## Setup

1. Install dependencies:
```bash
npm install
```

`@x402/next` requires Next.js 16.2.6 or later.

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

3. Start development server:
```bash
npm run dev
```

## Code

### `lib/x402.ts`: resource server

```typescript
import { x402ResourceServer } from '@x402/next';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';

const FACILITATOR_URL = process.env.FACILITATOR_URL!;
export const NETWORK = (process.env.NETWORK || 'eip155:421614') as `${string}:${string}`;

const facilitatorClient = new HTTPFacilitatorClient({
  url: FACILITATOR_URL,
  // A per-endpoint object is required; only /settle needs the key
  createAuthHeaders: async () => ({
    verify: {},
    settle: { 'X-API-Key': process.env.MERCHANT_API_KEY! },
    supported: {},
  }),
});

export const server = new x402ResourceServer(facilitatorClient).register(NETWORK, new ExactEvmScheme());

// Buyers pay the facilitator's signer address; it forwards your share
// to the merchant address tied to your API key.
let payTo: string | undefined;
export async function facilitatorPayTo(): Promise<string> {
  if (!payTo) {
    const supported = await fetch(`${FACILITATOR_URL}/supported`).then((r) => r.json());
    payTo = supported.signers['eip155:*'][0] as string;
  }
  return payTo;
}
```

### `app/api/premium-content/route.ts`: protected route

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { withX402 } from '@x402/next';
import { server, NETWORK, facilitatorPayTo } from '@/lib/x402';

const handler = async (_req: NextRequest) => {
  return NextResponse.json({
    title: 'Premium Content',
    body: 'This is the premium content you paid for!',
  });
};

export const GET = withX402(
  handler,
  {
    accepts: {
      scheme: 'exact',
      price: '$0.50', // must cover the facilitator gas fee (0.10 USDC by default)
      network: NETWORK,
      payTo: facilitatorPayTo, // resolved per request, cached after the first call
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
2. `withX402` responds `402` with a base64 `PaymentRequired` in the `PAYMENT-REQUIRED` header (`payTo` is the facilitator, `network` is CAIP-2, e.g. `eip155:421614`)
3. The client signs an EIP-3009 authorization and retries with `PAYMENT-SIGNATURE` (`@x402/fetch` does this automatically; see the [React client example](../react-client/))
4. `withX402` verifies with the facilitator and runs your handler
5. On a successful response it settles with the facilitator using your API key
6. The facilitator receives the funds and forwards your net amount
7. The response carries the settlement result in the `PAYMENT-RESPONSE` header

## Testing

1. Start the facilitator with `NETWORK=eip155:421614`
2. Run `npm run dev`
3. `curl -i http://localhost:3000/api/premium-content` returns 402 with `PAYMENT-REQUIRED`
4. Pay with a client such as the `basic-express` example's client: `RESOURCE_URL=http://localhost:3000/api/premium-content npm run client`

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [`@x402/next` README](https://github.com/x402-foundation/x402/tree/main/typescript/packages/http/next)
- [X402 Integration Guide](../../docs/INTEGRATION_GUIDE.md)
