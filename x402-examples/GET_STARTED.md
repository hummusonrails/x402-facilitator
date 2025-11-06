# X402 Examples

This directory contains example integrations with the X402 Facilitator for Arbitrum.

## Integration Overview

The x402 protocol simplifies payment integration:

1. **Client only needs**: `NEXT_PUBLIC_FACILITATOR_URL`
2. **Facilitator provides**: All payment requirements including its own address
3. **Fee model enforced**: Server-side by facilitator, cannot be bypassed
4. **Simplified setup**: No address management in client configuration

## Integration Flow

```
1. Client → POST /requirements → Facilitator
   Request: { amount, memo, extra: { merchantAddress } }
   Response: { network, token, recipient, amount, nonce, deadline, extra }

2. Client creates EIP-3009 permit
   Using recipient (facilitator address) from requirements

3. Client → POST /verify → Facilitator
   Request: { ...requirements, permit }
   Response: { valid: true, reason: null }

4. Merchant Backend → POST /settle → Facilitator
   Request: { ...requirements, permit }
   Response: { success: true, txHash, meta }
```

## SDK Compatibility

The facilitator is wire-compatible with Coinbase x402 SDK schemas:
- `PaymentRequirements` structure matches SDK expectations
- `PaymentPayload` with `permit` field follows SDK format
- Responses include SDK-standard fields (`valid`/`reason`, `success`/`txHash`)
- Additional data provided in `meta` field for rich integrations

## Quick Start Example

```typescript
const facilitatorUrl = process.env.NEXT_PUBLIC_FACILITATOR_URL;
const merchantAddress = '0xYourMerchantAddress';

// Step 1: Fetch requirements from facilitator
async function getPaymentRequirements(amount: string, memo: string) {
  const response = await fetch(`${facilitatorUrl}/requirements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount,
      memo,
      extra: { merchantAddress }
    })
  });
  return response.json();
}

// Step 2: Create EIP-3009 permit (using viem or ethers)
async function createPermit(requirements: any, signer: any) {
  const domain = {
    name: 'USD Coin',
    version: '2',
    chainId: 421614, // Arbitrum Sepolia
    verifyingContract: requirements.token,
  };

  const types = {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  };

  const message = {
    from: await signer.getAddress(),
    to: requirements.recipient, // Facilitator address from requirements
    value: requirements.amount,
    validAfter: 0,
    validBefore: requirements.deadline,
    nonce: requirements.nonce,
  };

  const signature = await signer._signTypedData(domain, types, message);
  
  return {
    owner: message.from,
    spender: message.to,
    value: message.value.toString(),
    deadline: message.validBefore,
    sig: signature,
  };
}

// Step 3: Verify payment
async function verifyPayment(requirements: any, permit: any) {
  const response = await fetch(`${facilitatorUrl}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...requirements,
      permit,
    })
  });
  return response.json();
}

// Step 4: Settle payment (backend only, requires merchant API key)
async function settlePayment(requirements: any, permit: any) {
  const response = await fetch(`${facilitatorUrl}/settle`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': process.env.MERCHANT_API_KEY,
    },
    body: JSON.stringify({
      ...requirements,
      permit,
    })
  });
  return response.json();
}

// Usage
const requirements = await getPaymentRequirements('2500000', 'Order #123');
const permit = await createPermit(requirements, signer);
const verification = await verifyPayment(requirements, permit);

if (verification.valid) {
  const settlement = await settlePayment(requirements, permit);
  console.log('Payment successful:', settlement.txHash);
}
```

## Available Examples

### Basic Express
Simple Express.js server demonstrating x402 integration.
- Location: `./basic-express`
- No client, server-side only
- Shows requirements generation and settlement

### Next.js App
Full-stack Next.js application with x402 payment flow.
- Location: `./nextjs-app`
- Client-side permit creation
- Server-side settlement
- **No facilitator address in env vars**

### React Client
React SPA demonstrating client-side integration.
- Location: `./react-client`
- Fetches requirements dynamically
- Creates and signs permits
- Delegates settlement to backend

## Environment Variables

### Client-Side (Frontend)
```env
NEXT_PUBLIC_FACILITATOR_URL=http://localhost:3002
```

### Server-Side (Backend)
```env
MERCHANT_API_KEY=your_api_key_here
MERCHANT_ADDRESS=0xYourMerchantAddress
```

**Note**: No facilitator address needed in configuration!

## Key Differences from Traditional Integration

### Before (Traditional)
```typescript
// Client needs to know facilitator address
const FACILITATOR_ADDRESS = '0xFAC1...C1T0R'; // ❌ Hardcoded

const paymentRequirements = {
  recipient: FACILITATOR_ADDRESS,
  amount: '1000000',
  nonce: generateNonce(), // Client generates
  // ...
};
```

### After (x402)
```typescript
// Client only needs URL
const requirements = await fetch(
  `${FACILITATOR_URL}/requirements`,
  { method: 'POST', body: JSON.stringify({ amount: '1000000' }) }
).then(r => r.json());

// Facilitator provides everything including its address
const permit = await createPermit(requirements); 
```

## Benefits

- **Simplified configuration**: Only facilitator URL needed
- **No address management**: Facilitator address provided dynamically
- **Dynamic requirements**: Fees and terms fetched at runtime
- **Server-enforced security**: Fee model enforced server-side

## Testing

1. Start the facilitator: `cd ../facilitator && pnpm dev`
2. Choose an example: `cd basic-express` (or `nextjs-app` or `react-client`)
3. Install dependencies: `npm install`
4. Configure env vars: `cp .env.example .env.local`
5. Run example: `npm run dev`

## Next Steps

- Read the [Integration Guide](../docs/INTEGRATION_GUIDE.md) for detailed documentation
- Review [Merchant Management](../docs/MERCHANT_MANAGEMENT.md) for API key setup
- Check [Authentication Guide](../docs/AUTHENTICATION_GUIDE.md) for security setup
