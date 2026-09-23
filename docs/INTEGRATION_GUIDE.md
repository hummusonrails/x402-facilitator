# Merchant Integration Guide

## Overview

This guide explains how merchants integrate with the facilitator using the official x402 v2 SDKs from [x402-foundation/x402](https://github.com/x402-foundation/x402). The facilitator implements the standard `/verify`, `/settle`, and `/supported` endpoints, so the SDK's `HTTPFacilitatorClient` works against it directly. Networks use CAIP-2 identifiers (`eip155:421614` for Arbitrum Sepolia, `eip155:42161` for Arbitrum One), and each facilitator instance settles on exactly one of them.

## Payment Flow

```
Buyer -> Facilitator (total, payTo = facilitator) -> Merchant (net amount)
```

The buyer pays the facilitator's signer address. The facilitator keeps its fee and forwards your share to the merchant address tied to your API key. You never put your own address in `payTo`.

On the wire, between the buyer and your server (see the spec's [HTTP transport](https://github.com/x402-foundation/x402/blob/main/specs/transports-v2/http.md)):

1. Your server replies `402` with a base64 `PaymentRequired` in the `PAYMENT-REQUIRED` header.
2. The buyer retries with a base64 `PaymentPayload` in the `PAYMENT-SIGNATURE` header.
3. Your server verifies and settles through the facilitator, then returns the content with a base64 `SettleResponse` in the `PAYMENT-RESPONSE` header.

The SDK middleware does all of this for you.

## Step 1: Get an API key

Ask the facilitator operator to register your merchant address and issue an API key (see [MERCHANT_MANAGEMENT.md](MERCHANT_MANAGEMENT.md)). The key is only sent on `/settle`.

## Step 2: Protect your routes

Install the SDK:

```bash
npm install @x402/express @x402/core @x402/evm
```

```typescript
import express from 'express';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { HTTPFacilitatorClient } from '@x402/core/server';

const FACILITATOR_URL = process.env.FACILITATOR_URL!;
const NETWORK = 'eip155:421614';

const facilitatorClient = new HTTPFacilitatorClient({
  url: FACILITATOR_URL,
  // The SDK requires a per-endpoint object; a flat headers object throws
  createAuthHeaders: async () => ({
    verify: {},
    settle: { 'X-API-Key': process.env.MERCHANT_API_KEY! },
    supported: {},
  }),
});

const resourceServer = new x402ResourceServer(facilitatorClient).register(NETWORK, new ExactEvmScheme());

// payTo is the facilitator's signer address, advertised by GET /supported
const supported = await fetch(`${FACILITATOR_URL}/supported`).then((r) => r.json());
const payTo = supported.signers['eip155:*'][0];

const app = express();

app.use(
  paymentMiddleware(
    {
      'GET /premium-content': {
        accepts: {
          scheme: 'exact',
          price: '$0.50', // must cover the facilitator's gas fee (0.10 USDC by default)
          network: NETWORK,
          payTo,
        },
        description: 'Premium content access',
        mimeType: 'application/json',
      },
    },
    resourceServer,
  ),
);

// Runs only after the payment verifies; settlement happens after the response
app.get('/premium-content', (_req, res) => {
  res.json({ title: 'Premium Content', data: 'Your protected content here' });
});
```

For Next.js, use `withX402` or `paymentProxy` from `@x402/next` with the same `x402ResourceServer` (see [`x402-examples/nextjs-app`](../x402-examples/nextjs-app/)).

## Step 3: Clients pay

Buyers use `@x402/fetch` (or `@x402/axios`). The wrapper reads the 402, signs an EIP-3009 authorization to the facilitator, and retries with `PAYMENT-SIGNATURE`.

```typescript
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm';
import { privateKeyToAccount } from 'viem/accounts';

const account = privateKeyToAccount(process.env.PAYER_PRIVATE_KEY as `0x${string}`);

const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: 'eip155:421614', client: new ExactEvmScheme(account) }],
});

const response = await fetchWithPayment('https://api.example.com/premium-content');
const header = response.headers.get('PAYMENT-RESPONSE');
if (header) {
  console.log(decodePaymentResponseHeader(header));
}
```

In the browser, pass a wagmi/viem wallet client instead of a local account (see [`x402-examples/react-client`](../x402-examples/react-client/)).

## Settlement response

The facilitator's `/settle` response is what the middleware encodes into `PAYMENT-RESPONSE`:

```json
{
  "success": true,
  "payer": "0xPayerAddress",
  "transaction": "0xPAYER_TRANSFER_TX_HASH",
  "network": "eip155:421614",
  "amount": "500000",
  "extra": {
    "merchantAddress": "0xMerchantAddress",
    "forward": { "status": "complete", "transaction": "0xFORWARD_TX_HASH" },
    "feeBreakdown": {
      "merchantAmount": "398009",
      "serviceFee": "1991",
      "gasFee": "100000",
      "totalAmount": "500000"
    }
  }
}
```

- `transaction` is the buyer to facilitator transfer.
- `extra.forward.status` is `"complete"` once your share is forwarded, or `"pending"` if forwarding will be retried by the facilitator's recovery worker.
- On failure, `success` is `false` and `errorReason` holds a spec error code. `settlement_pending` is not terminal: retrying the same payload with the same API key reconciles against the already broadcast transaction.

See the [root README](../README.md#error-codes) for the full request/response reference and error codes.

## Key Points

- `payTo` is always the facilitator's signer address from `GET /supported` (`signers["eip155:*"][0]`).
- The merchant that gets paid is the one tied to the API key on `/settle`. Keep that key on the server.
- The price is the gross amount the buyer pays and must be at least the gas fee (0.10 USDC by default).
- Only the `exact` scheme with EIP-3009 (USDC) is supported; Permit2 and ERC-7710 payloads are rejected.
- x402 v1 payloads (`X-PAYMENT` header, legacy network names) are still accepted for backward compatibility.

## Testing checklist

- An unpaid request returns `402` with a `PAYMENT-REQUIRED` header.
- `accepts[0].payTo` matches the facilitator signer from `/supported`, and `network` matches the facilitator's `NETWORK`.
- A paid request returns `200` with a `PAYMENT-RESPONSE` header whose `success` is `true`.
- The merchant address in `extra.merchantAddress` is yours.
