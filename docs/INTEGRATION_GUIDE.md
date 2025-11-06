# Merchant Integration Guide

## Overview

This guide explains how merchants integrate with the x402 facilitator. Merchants only need the facilitator URL; the facilitator address is provided dynamically.

## Payment Flow

```
User → Facilitator (total with fees) → Merchant (amount only)
```

**Key Point:** The user sends payment to the **facilitator address**, not the merchant address. The facilitator then forwards the merchant's portion.

## Step 1: Register with Facilitator

Contact the facilitator operator to register your merchant address:

```
Merchant Address: 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb
Merchant Name: MyStore
```

The facilitator will add you to their `MERCHANT_ADDRESSES` configuration.


## Step 2: Return 402 with Facilitator URL

When creating a 402 response, return the facilitator URL and payment details. The facilitator will calculate fees and provide complete requirements:

```typescript
// Your merchant amount (what you want to receive)
const merchantAmount = 1000000; // 1 USDC (6 decimals)

// Return 402 response
res.status(402).json({
  error: 'Payment Required',
  facilitatorUrl: process.env.FACILITATOR_URL,
  amount: merchantAmount.toString(),
  merchantAddress: process.env.MERCHANT_ADDRESS,
  description: 'Premium content access',
});
```

## Step 3: Client Fetches Requirements

The client uses the facilitator URL to fetch complete payment requirements:

```typescript
const response = await fetch(`${facilitatorUrl}/requirements`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    amount: merchantAmount,
    memo: description,
    extra: { merchantAddress }
  })
});

const requirements = await response.json();
```

The facilitator returns complete requirements including its own address:

```json
{
  "network": "arbitrum-sepolia",
  "token": "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
  "recipient": "0xFACILITATOR_ADDRESS",
  "amount": "1100500",
  "nonce": "0x...",
  "deadline": 1731024000,
  "memo": "Premium content access",
  "extra": {
    "feeMode": "facilitator_split",
    "merchantAddress": "0xYOUR_MERCHANT_ADDRESS",
    "feeBps": 50,
    "gasBufferWei": "100000"
  }
}
```

### Key Points

- The `recipient` is the facilitator's address (set by facilitator)
- The `amount` includes all fees (calculated by facilitator)
- The `extra.merchantAddress` tells the facilitator where to forward funds
- Client never needs to know or configure the facilitator address
| `description` | Fee disclosure | Explain why amount > sticker price |

## Step 4: User Payment Flow

1. **User sees 402 response** with total amount (1.105 USDC)
2. **User signs EIP-3009 authorization** for total to facilitator
3. **User calls facilitator `/settle`** endpoint
4. **Facilitator executes two transactions:**
   - Tx 1: User → Facilitator (1.105 USDC)
   - Tx 2: Facilitator → Merchant (1.00 USDC)
5. **Merchant receives payment** (1.00 USDC in your wallet)
6. **Facilitator keeps fee** (0.105 USDC)

## Step 5: Verify Payment

After settlement, you'll receive the merchant amount in your wallet. The facilitator returns:

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

Check `outgoingTransactionHash` on Arbiscan to verify the payment to your address.

## Example: Complete Integration

```typescript
import express from 'express';

const app = express();

// Facilitator configuration
const FACILITATOR_URL = 'https://facilitator.example.com';
const SERVICE_FEE_BPS = 50;
const GAS_FEE_USDC = 100000;
const MERCHANT_ADDRESS = '0xYOUR_ADDRESS';

// Helper: Calculate total with fees
function calculateTotalWithFees(merchantAmount: number) {
  const serviceFee = Math.floor(merchantAmount * SERVICE_FEE_BPS / 10000);
  const totalAmount = merchantAmount + serviceFee + GAS_FEE_USDC;
  return {
    merchantAmount,
    serviceFee,
    gasFee: GAS_FEE_USDC,
    totalAmount,
  };
}

// Protected resource endpoint
app.get('/premium-content', (req, res) => {
  const merchantAmount = 1000000; // 1 USDC for this content
  const fees = calculateTotalWithFees(merchantAmount);

  // Return 402 Payment Required
  res.status(402).json({
    error: 'Payment Required',
    facilitatorUrl: FACILITATOR_URL,
    feeBreakdown: {
      contentPrice: `${fees.merchantAmount/1e6} USDC`,
      serviceFee: `${fees.serviceFee/1e6} USDC (${SERVICE_FEE_BPS/100}%)`,
      gasFee: `${fees.gasFee/1e6} USDC`,
      total: `${fees.totalAmount/1e6} USDC`,
    },
  });
});

// After payment, verify and serve content
app.get('/premium-content/verify', async (req, res) => {
  const { transactionHash } = req.query;
  
  // Verify transaction onchain
  // Check that outgoingTransactionHash sent funds to MERCHANT_ADDRESS
  // Check amount matches expected merchantAmount
  
  // If valid, serve content
  res.json({ content: 'Premium content here...' });
});
```

## Fee Transparency

Always disclose fees to users. Example descriptions:

```typescript
// Good: Clear fee breakdown
description: "Premium article - 1.00 USDC + 0.005 service fee + 0.10 gas = 1.105 USDC total"

// Better: Percentage and absolute
description: "1.00 USDC content + 0.5% facilitator fee + 0.10 USDC gas (1.105 USDC total)"

// Best: Link to fee schedule
description: "1.00 USDC + fees (see facilitator.example.com/fees) = 1.105 USDC"
```

## Testing

### Test on Arbitrum Sepolia

1. Get test USDC from facilitator or faucet
2. Create a test 402 response with small amount (0.01 USDC)
3. Use a test wallet to complete payment
4. Verify you receive the merchant amount

### Verify Calculations

```typescript
// Test fee calculation
const merchantAmount = 1000000;
const serviceFee = Math.floor(merchantAmount * 50 / 10000); // 500
const gasFee = 100000;
const total = merchantAmount + serviceFee + gasFee; // 1100500

// Reverse calculation (what facilitator does)
const totalMinusGas = total - gasFee; // 1000500
const feeMultiplier = 10000 + 50; // 10050
const calculatedMerchant = Math.floor(totalMinusGas * 10000 / feeMultiplier); // 1000000

console.assert(calculatedMerchant === merchantAmount, 'Fee calculation mismatch!');
```

## Common Issues

### Issue: Payment rejected with "Invalid recipient"

**Cause:** You set `recipient` to your merchant address instead of facilitator address.

**Fix:** Set `recipient` to facilitator address, add `merchantAddress` field with your address.

### Issue: Amount mismatch error

**Cause:** Fee calculation doesn't match facilitator's calculation due to rounding.

**Fix:** Use integer math with floor division:
```typescript
const serviceFee = Math.floor(merchantAmount * SERVICE_FEE_BPS / 10000);
```

### Issue: Merchant not registered

**Cause:** Your address isn't in facilitator's `MERCHANT_ADDRESSES`.

**Fix:** Contact facilitator operator to register your address.

## Security Considerations

1. **Verify onchain:** Always verify the `outgoingTransactionHash` on Arbiscan
2. **Check amount:** Ensure you received the expected `merchantAmount`
3. **Monitor payments:** Set up alerts for incoming payments to your address
4. **Rate limiting:** Implement rate limiting on your 402 endpoints
5. **Nonce tracking:** Store transaction hashes to prevent double-spending

## Support

Contact your facilitator operator for:
- Registration
- Fee schedule
- Technical support
- Dispute resolution
- Refund requests

## Advanced: Dynamic Pricing

Adjust merchant amount based on content value:

```typescript
const contentPrices = {
  article: 1000000,      // 1 USDC
  video: 5000000,        // 5 USDC
  course: 50000000,      // 50 USDC
};

function getPriceWithFees(contentType: string) {
  const merchantAmount = contentPrices[contentType];
  return calculateTotalWithFees(merchantAmount);
}
```

## Appendix: Fee Calculation Formula

```
Given:
- M = merchant amount (what you want)
- F = service fee in basis points (e.g., 50 for 0.5%)
- G = gas fee in USDC (e.g., 100000 for 0.1 USDC)

Forward calculation (merchant → total):
  serviceFee = floor(M * F / 10000)
  total = M + serviceFee + G

Reverse calculation (total → merchant):
  totalMinusGas = total - G
  merchant = floor(totalMinusGas * 10000 / (10000 + F))

Verification:
  recalculated_total = merchant + floor(merchant * F / 10000) + G
  assert(recalculated_total == total)
```
