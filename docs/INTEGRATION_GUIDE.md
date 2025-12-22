# Merchant Integration Guide

## Overview

This guide explains how merchants integrate with the facilitator. Clients only need the facilitator URL; requirements are returned in the `PAYMENT-RESPONSE` header (mirrored to `X-PAYMENT-RESPONSE` for legacy clients). Networks use CAIP-2 identifiers (`eip155:421614`, `eip155:42161`).

## Payment Flow

```
User → Facilitator (total with fees) → Merchant (net amount)
```

## Step 1: Return 402 with facilitator requirements header

When the user requests a protected resource, fetch requirements from the facilitator and forward them in the payment headers.

```typescript
import express from 'express';
import fetch from 'node-fetch';

const FACILITATOR_URL = process.env.FACILITATOR_URL!;
const MERCHANT_ADDRESS = process.env.MERCHANT_ADDRESS!;

const app = express();

app.get('/premium-content', async (_req, res) => {
  const requirementsResponse = await fetch(`${FACILITATOR_URL}/requirements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: '1000000',
      extra: {
        description: 'Premium content access',
        merchantAddress: MERCHANT_ADDRESS,
      },
    }),
  });

  const requirements = await requirementsResponse.json();
  const serialized = JSON.stringify(requirements);

  res.setHeader('PAYMENT-RESPONSE', serialized);
  res.setHeader('X-PAYMENT-RESPONSE', serialized); // legacy mirror
  res.status(402).json({
    error: 'Payment Required',
    facilitatorUrl: FACILITATOR_URL,
  });
});
```

## Step 2: Client creates payment signature

On the client, use the requirements returned in `PAYMENT-RESPONSE` to create a signature. For Axios users:

```typescript
import { x402Client, wrapAxiosWithPayment } from '@x402/axios';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { privateKeyToAccount } from 'viem/accounts';
import axios from 'axios';

const signer = privateKeyToAccount(process.env.NEXT_PUBLIC_EVM_PRIVATE_KEY as `0x${string}`);
const client = new x402Client();
registerExactEvmScheme(client, { signer });

const api = wrapAxiosWithPayment(
  axios.create({ baseURL: '/api' }),
  client,
);

// Example: fetching protected content will automatically handle payments
const response = await api.get('/premium-content');
```

## Step 3: Submit payment to your backend

Send the signed payment payload to your backend. The backend can read it from the body or from the `PAYMENT-SIGNATURE` header.

```typescript
await fetch('/api/premium-content', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'PAYMENT-SIGNATURE': JSON.stringify(payment), // optional if not in body
  },
  body: JSON.stringify(payment),
});
```

## Step 4: Backend settles with facilitator

Call the facilitator `/settle` endpoint with your merchant API key.

```typescript
app.post('/premium-content', async (req, res) => {
  const payload = req.body?.paymentPayload ? req.body : JSON.parse(req.header('PAYMENT-SIGNATURE') || '{}');
  const { paymentPayload, paymentRequirements } = payload || {};

  if (!paymentPayload || !paymentRequirements) {
    return res.status(400).json({ error: 'Missing payment data' });
  }

  const settlementResponse = await fetch(`${FACILITATOR_URL}/settle`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': process.env.MERCHANT_API_KEY!,
    },
    body: JSON.stringify({ paymentPayload, paymentRequirements }),
  });

  const result = await settlementResponse.json();
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  res.json({
    success: true,
    content: { title: 'Premium Content', data: 'Your protected content here' },
    payment: {
      transactionHash: result.outgoingTransactionHash,
      blockNumber: result.blockNumber,
    },
  });
});
```

## Key Points

- Requirements come from the facilitator and must be forwarded in `PAYMENT-RESPONSE`.
- Clients should consume requirements from headers; legacy clients can still read the JSON body.
- Networks are CAIP-2 identifiers; the facilitator accepts legacy aliases but responds with CAIP-2.
- The recipient is always the facilitator address; the facilitator forwards the merchant share after settlement.

## Example verification response

```json
{
  "success": true,
  "transactionHash": "0x...",
  "incomingTransactionHash": "0x...",
  "outgoingTransactionHash": "0x...",
  "blockNumber": 12345678,
  "status": "confirmed",
  "feeBreakdown": {
    "merchantAmount": "1000000",
    "serviceFee": "500",
    "gasFee": "100000",
    "totalAmount": "1100500"
  }
}
```

## Testing checklist

- 402 responses include `PAYMENT-RESPONSE` header.
- Clients sign with CAIP-2 networks (`eip155:421614`/`eip155:42161`).
- Settlements succeed when `PAYMENT-SIGNATURE` or request body includes the payment payload.
