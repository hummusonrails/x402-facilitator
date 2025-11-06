# X402 Integration Walkthrough

A step-by-step guide to integrating x402 payments into your application.

## Overview

The x402 payment flow involves three parties:
1. **User** - Pays with USDC using EIP-3009 signatures
2. **Merchant** - Your application receiving payment
3. **Facilitator** - Handles payment settlement, fees, network and token validation

## Payment Flow

```
1. User requests protected resource
   ↓
2. Server returns 402 with payment requirements
   ↓
3. User creates EIP-3009 signature (client-side)
   ↓
4. User submits payment to server
   ↓
5. Server settles payment with facilitator (backend)
   ↓
6. Facilitator executes on-chain transactions
   ↓
7. Server returns protected resource
```

## Step-by-Step Implementation

### Step 1: Return 402 with Facilitator URL

When a user requests a protected resource without payment:

```javascript
app.get('/api/premium-content', (req, res) => {
  res.status(402).json({
    error: 'Payment required',
    facilitatorUrl: process.env.FACILITATOR_URL,
    amount: '1000000',
    merchantAddress: process.env.MERCHANT_ADDRESS,
    description: 'Premium content access',
  });
});
```

### Step 2: Client Creates EIP-3009 Signature

Note: The client library or wallet handles signature creation. The facilitator provides the network, token, and recipient details. Your merchant app only needs to specify the amount and merchant address.

Example using a hypothetical x402 client library:

```typescript
import { createPayment } from '@x402/client';

async function createPaymentSignature(
  paymentRequirements: PaymentRequirements
) {
  const payment = await createPayment({
    merchantAddress: paymentRequirements.merchantAddress,
    amount: paymentRequirements.amount,
    description: paymentRequirements.description,
  });

  return payment;
}
```

### Step 3: Submit Payment to Your Backend

Client sends the signed payment to your server:

```typescript
async function submitPayment(payment: Payment) {
  const response = await fetch('/api/premium-content', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payment),
  });

  if (!response.ok) {
    throw new Error('Payment failed');
  }

  return await response.json();
}
```

### Step 4: Backend Settles with Facilitator

Your server settles the payment (NEVER expose API key to client):

```javascript
app.post('/api/premium-content', async (req, res) => {
  const { paymentPayload, paymentRequirements } = req.body;

  try {
    const settlementResponse = await fetch(`${FACILITATOR_URL}/settle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': MERCHANT_API_KEY,
      },
      body: JSON.stringify({
        paymentPayload,
        paymentRequirements,
      }),
    });

    const result = await settlementResponse.json();

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      success: true,
      content: {
        title: 'Premium Content',
        data: 'Your protected content here',
      },
      payment: {
        transactionHash: result.outgoingTransactionHash,
        blockNumber: result.blockNumber,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

## Security Best Practices

### 1. Never Expose API Key

```javascript
// WRONG: Never do this
const apiKey = 'your-api-key';
fetch('/settle', {
  headers: { 'X-API-Key': apiKey }
});

// CORRECT: API key stays on server
// Client calls your backend, backend calls facilitator
```

### 2. Validate Payment Requirements

```javascript
// Verify the payment matches your expected amount
if (paymentRequirements.amount !== EXPECTED_AMOUNT) {
  throw new Error('Invalid payment amount');
}

// Verify merchant address matches yours
if (paymentRequirements.merchantAddress !== YOUR_ADDRESS) {
  throw new Error('Invalid merchant address');
}
```

### 3. Handle Errors Gracefully

```javascript
try {
  const result = await settlePayment(payment);
  // Success
} catch (error) {
  if (error.message.includes('Nonce already used')) {
    // Payment already processed
  } else if (error.message.includes('Insufficient balance')) {
    // User doesn't have enough USDC
  } else {
    // Other error
  }
}
```

## Testing

### 1. Get Test USDC

On Arbitrum Sepolia:
1. Get ETH from [Arbitrum Sepolia faucet](https://faucet.quicknode.com/arbitrum/sepolia)
2. Get test USDC from Circle's faucet or bridge

### 2. Test Payment Flow

```bash
# 1. Start facilitator
cd facilitator
npm start

# 2. Start your backend
cd your-app
npm start

# 3. Open frontend and test payment
```

## Common Issues

### Issue: Nonce already used
**Solution:** Each payment needs a unique nonce. Generate a new random nonce for each payment.

### Issue: Invalid signature
**Solution:** Ensure you're signing with the correct EIP-712 domain and types for USDC.

### Issue: Merchant not approved
**Solution:** Wait for admin approval after merchant registration.

### Issue: Insufficient balance
**Solution:** User needs USDC in their wallet on Arbitrum Sepolia.

## Next Steps

1. Review the [basic Express example](./basic-express/)
2. Explore the [Next.js full-stack example](./nextjs-app/)
3. Check the [React client example](./react-client/)
4. Read the [full integration guide](../docs/INTEGRATION_GUIDE.md)

## Support

- GitHub Issues: [x402-facilitator/issues](https://github.com/hummusonrails/x402-facilitator/issues)
- Documentation: [Integration Guide](../docs/INTEGRATION_GUIDE.md)
