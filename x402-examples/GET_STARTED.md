# X402 Examples

This directory contains example integrations with the X402 Facilitator for Arbitrum.

## Overview

The facilitator implements the x402 v2 facilitator API (`/verify`, `/settle`, `/supported`), so you integrate with the official SDKs from [x402-foundation/x402](https://github.com/x402-foundation/x402) instead of hand-rolling requests:

1. **Resource server**: `@x402/express` or `@x402/next` middleware with an `HTTPFacilitatorClient` pointed at the facilitator
2. **Client**: `@x402/fetch` or `@x402/axios` with an `ExactEvmScheme` signer from `@x402/evm`
3. **Fee model**: buyers pay the facilitator's signer address; the facilitator keeps its fee and forwards your share to the address tied to your API key
4. **Configuration**: the facilitator URL, your merchant API key, and the network

## Integration Flow

```
1. Server startup: GET /supported -> Facilitator
   Response: { kinds: [...], extensions: [], signers: { "eip155:*": ["0xFacilitatorAddress"] } }
   The signer address is your payTo.

2. Client -> GET /api/premium-content -> Your server
   402 with PAYMENT-REQUIRED header (base64 PaymentRequired:
   { x402Version: 2, resource, accepts: [{ scheme: "exact", network: "eip155:421614",
     amount, asset, payTo, maxTimeoutSeconds, extra: { name: "USD Coin", version: "2" } }] })

3. Client signs an EIP-3009 authorization (to = payTo, value = amount)
   and retries with PAYMENT-SIGNATURE header (base64 PaymentPayload)

4. Your server -> POST /verify -> Facilitator (public)
   Body: { x402Version: 2, paymentPayload, paymentRequirements }
   Response: { isValid, invalidReason?, payer }

5. Your server -> POST /settle -> Facilitator (X-API-Key)
   Body: same as /verify
   Response: { success, transaction, network, payer, amount, extra: { merchantAddress, forward, feeBreakdown } }

6. Your server -> 200 with PAYMENT-RESPONSE header (base64 settle response)
```

Steps 2 through 6 are handled by the SDK middleware and client wrapper.

## Quick Start Code Example

Server (Express):

```typescript
import express from 'express';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { HTTPFacilitatorClient } from '@x402/core/server';

const FACILITATOR_URL = process.env.FACILITATOR_URL!;
const NETWORK = 'eip155:421614';

const facilitatorClient = new HTTPFacilitatorClient({
  url: FACILITATOR_URL,
  createAuthHeaders: async () => ({
    verify: {},
    settle: { 'X-API-Key': process.env.MERCHANT_API_KEY! },
    supported: {},
  }),
});
const resourceServer = new x402ResourceServer(facilitatorClient).register(NETWORK, new ExactEvmScheme());

const supported = await fetch(`${FACILITATOR_URL}/supported`).then((r) => r.json());
const payTo = supported.signers['eip155:*'][0];

const app = express();
app.use(
  paymentMiddleware(
    {
      'GET /api/premium-content': {
        accepts: { scheme: 'exact', price: '$0.50', network: NETWORK, payTo },
        description: 'Access to premium content',
      },
    },
    resourceServer,
  ),
);
app.get('/api/premium-content', (_req, res) => res.json({ data: 'premium' }));
app.listen(3000);
```

Client:

```typescript
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm';
import { privateKeyToAccount } from 'viem/accounts';

const account = privateKeyToAccount(process.env.PAYER_PRIVATE_KEY as `0x${string}`);
const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: 'eip155:421614', client: new ExactEvmScheme(account) }],
});

const response = await fetchWithPayment('http://localhost:3000/api/premium-content');
console.log(await response.json());

const header = response.headers.get('PAYMENT-RESPONSE');
if (header) {
  const settlement = decodePaymentResponseHeader(header);
  console.log('Payment tx:', settlement.transaction);
}
```

## Available Examples

### Basic Express
Runnable Express.js resource server plus a paying client.
- Location: `./basic-express`
- `npm start` runs the server, `npm run client` pays for the protected route

### Next.js App
Runnable Next.js 16 app protecting an API route with `@x402/next`.
- Location: `./nextjs-app`
- `withX402` route wrapper
- `payTo` read dynamically from the facilitator

### React Client
README guide for paying from the browser.
- Location: `./react-client`
- wagmi wallet client as the x402 signer
- `@x402/fetch` handles the 402 and retry

## Environment Variables

### Resource server
```env
FACILITATOR_URL=http://localhost:3002
MERCHANT_API_KEY=your_api_key_here
NETWORK=eip155:421614
```

### Client
```env
RESOURCE_URL=http://localhost:3000/api/premium-content
PAYER_PRIVATE_KEY=0xYourTestWalletPrivateKey   # Node clients only; browsers use the connected wallet
```

**Note**: No facilitator or merchant address is needed in configuration. `payTo` comes from `GET /supported`, and your merchant address comes from your API key.

## Benefits

- **Standard SDKs**: the official x402 middleware and clients work unchanged
- **No address management**: the facilitator address is discovered at runtime
- **Server-enforced fees**: the fee split is computed by the facilitator at settlement
- **Backward compatible**: x402 v1 payloads are still accepted

## Testing

1. Start the facilitator: `cd ../facilitator && pnpm dev`
2. Go to the runnable example: `cd basic-express`
3. Install dependencies: `npm install`
4. Configure env vars: `cp .env.example .env`
5. Run the server: `npm start`
6. In another terminal, pay for the route: `npm run client`

## Next Steps

- Read the [Integration Guide](../docs/INTEGRATION_GUIDE.md) for detailed documentation
- Review [Merchant Management](../docs/MERCHANT_MANAGEMENT.md) for API key setup
- Check [Authentication Guide](../docs/AUTHENTICATION_GUIDE.md) for security setup
