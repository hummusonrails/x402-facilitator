# X402 Integration Walkthrough

A step-by-step guide to integrating x402 payments into your application.

## Overview

The x402 payment flow involves three parties:
1. **User**: pays with USDC by signing an EIP-3009 authorization
2. **Merchant**: your application, the resource server
3. **Facilitator**: verifies and settles payments, takes its fee, and forwards your share

This walkthrough uses the official x402 v2 SDKs from [x402-foundation/x402](https://github.com/x402-foundation/x402). The runnable version is in [`basic-express`](./basic-express/).

## Payment Flow

```
1. User requests protected resource
   ↓
2. Server returns 402 with a PAYMENT-REQUIRED header (payTo = facilitator)
   ↓
3. User signs an EIP-3009 authorization (client-side)
   ↓
4. User retries with a PAYMENT-SIGNATURE header
   ↓
5. Server verifies and settles with the facilitator (backend, API key on /settle)
   ↓
6. Facilitator pulls the payment to itself and forwards your share onchain
   ↓
7. Server returns the resource with a PAYMENT-RESPONSE header
```

## Step-by-Step Implementation

### Step 1: Connect to the facilitator

Create an `HTTPFacilitatorClient` that sends your merchant API key only on `/settle`, and read the facilitator's signer address from `GET /supported`. That address is the `payTo` buyers pay; the facilitator forwards your share to the merchant address tied to your API key.

```javascript
import { x402ResourceServer } from '@x402/express';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { HTTPFacilitatorClient } from '@x402/core/server';

const FACILITATOR_URL = process.env.FACILITATOR_URL;
const NETWORK = process.env.NETWORK || 'eip155:421614'; // must match the facilitator

const facilitatorClient = new HTTPFacilitatorClient({
  url: FACILITATOR_URL,
  // A per-endpoint object is required; a flat headers object throws
  createAuthHeaders: async () => ({
    verify: {},
    settle: { 'X-API-Key': process.env.MERCHANT_API_KEY },
    supported: {},
  }),
});

const resourceServer = new x402ResourceServer(facilitatorClient).register(NETWORK, new ExactEvmScheme());

const supported = await fetch(`${FACILITATOR_URL}/supported`).then((r) => r.json());
const payTo = supported.signers['eip155:*'][0];
```

### Step 2: Protect the route

`paymentMiddleware` returns the 402 with `PAYMENT-REQUIRED`, verifies the `PAYMENT-SIGNATURE` on the retry, runs your handler, then settles and sets `PAYMENT-RESPONSE`.

```javascript
import express from 'express';
import { paymentMiddleware } from '@x402/express';

const app = express();

app.use(
  paymentMiddleware(
    {
      'GET /api/premium-content': {
        accepts: {
          scheme: 'exact',
          price: '$0.50', // gross price; must cover the facilitator gas fee (0.10 USDC by default)
          network: NETWORK,
          payTo,
        },
        description: 'Access to premium content',
        mimeType: 'application/json',
      },
    },
    resourceServer,
  ),
);

app.get('/api/premium-content', (req, res) => {
  res.json({ title: 'Premium Content', data: 'Your protected content here' });
});
```

### Step 3: Client pays

`@x402/fetch` handles the 402, signs the authorization, and retries with `PAYMENT-SIGNATURE`. In Node, use a viem local account; in the browser, use the connected wallet (see [`react-client`](./react-client/)).

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
```

### Step 4: Read the settlement

The `PAYMENT-RESPONSE` header carries the facilitator's settle response:

```typescript
const header = response.headers.get('PAYMENT-RESPONSE');
if (header) {
  const settlement = decodePaymentResponseHeader(header);
  // extra is facilitator-specific, typed as Record<string, unknown> by the SDK
  const extra = settlement.extra as {
    feeBreakdown: { merchantAmount: string };
    forward: { status: 'complete' | 'pending'; transaction?: string };
  };
  console.log('Payment tx:', settlement.transaction);
  console.log('Your share:', extra.feeBreakdown.merchantAmount);
  console.log('Forward status:', extra.forward.status); // "complete" or "pending"
}
```

`forward.status: "pending"` means the buyer's payment landed and the facilitator's recovery worker will finish forwarding your share.

## Security Best Practices

### 1. Never Expose API Key

```javascript
// WRONG: Never do this in client code
const apiKey = 'your-api-key';
fetch('/settle', {
  headers: { 'X-API-Key': apiKey }
});

// CORRECT: API key stays on server
// The SDK sends it from your backend, and only on /settle
```

### 2. Use the facilitator as payTo

`payTo` must be the facilitator's signer address from `GET /supported`. Using your own address fails with `invalid_exact_evm_recipient_mismatch`. Your merchant address is determined by your API key, so a buyer cannot redirect your share.

### 3. Handle Errors Gracefully

When settlement fails, the middleware does not deliver the content. If you call the facilitator yourself, branch on `errorReason`:

```javascript
const result = await settleResponse.json();
if (!result.success) {
  switch (result.errorReason) {
    case 'settlement_pending':
      // Broadcast but unconfirmed: retry the same payload with the same key to reconcile
      break;
    case 'invalid_exact_evm_nonce_already_used':
      // Payment already processed
      break;
    case 'insufficient_funds':
      // User doesn't have enough USDC
      break;
    default:
      // Other error; see the README error code table
  }
}
```

## Testing

### 1. Get Test USDC

On Arbitrum Sepolia:
1. Get test USDC from Circle's faucet or bridge
2. The buyer does not need ETH: the facilitator pays gas and recovers it through its gas fee

### 2. Test Payment Flow

```bash
# 1. Start facilitator
cd facilitator
pnpm dev

# 2. Start the example server
cd x402-examples/basic-express
npm start

# 3. Pay for the protected route
npm run client
```

## Common Issues

### Issue: `invalid_exact_evm_nonce_already_used`
**Solution:** The authorization was already used. The SDK generates a fresh nonce per payment; don't replay old payloads.

### Issue: `invalid_exact_evm_signature`
**Solution:** Ensure requirements include `extra.name: "USD Coin"` and `extra.version: "2"`, and the client signs for the facilitator's network.

### Issue: `invalid_exact_evm_recipient_mismatch`
**Solution:** Use the facilitator's signer address from `GET /supported` as `payTo`.

### Issue: `amount_below_facilitator_fee`
**Solution:** Set a price above the facilitator's gas fee (0.10 USDC by default).

### Issue: Merchant not approved
**Solution:** Wait for admin approval after merchant registration.

### Issue: `insufficient_funds`
**Solution:** User needs USDC in their wallet on Arbitrum Sepolia.

## Next Steps

1. Review the [basic Express example](./basic-express/)
2. Explore the [Next.js full-stack example](./nextjs-app/)
3. Check the [React client example](./react-client/)
4. Read the [full integration guide](../docs/INTEGRATION_GUIDE.md)

## Support

- GitHub Issues: [x402-facilitator/issues](https://github.com/hummusonrails/x402-facilitator/issues)
- Documentation: [Integration Guide](../docs/INTEGRATION_GUIDE.md)
