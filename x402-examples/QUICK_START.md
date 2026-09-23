# Quick Start Guide

Get started with x402 payment integration in 5 minutes.

## Prerequisites

- Node.js 18+
- A running facilitator configured for Arbitrum Sepolia (`NETWORK=eip155:421614`)
- A test wallet with test USDC on Arbitrum Sepolia (the buyer does not need ETH; the facilitator pays gas)
- Merchant account (register at facilitator dashboard)

## 1. Register as Merchant

Visit the facilitator dashboard and register:

```
http://your-facilitator.com/register
```

Save your API key securely. You'll never see it again!

## 2. Choose Your Example

### Option A: Basic Express (Simplest)

```bash
cd basic-express
npm install
cp .env.example .env
# Edit .env: FACILITATOR_URL, MERCHANT_API_KEY, NETWORK, and PAYER_PRIVATE_KEY for the client
npm start
```

Test it:
```bash
# Unpaid: returns 402 with a PAYMENT-REQUIRED header
curl -i http://localhost:3000/api/premium-content

# Paid: signs with PAYER_PRIVATE_KEY and prints the settlement
npm run client
```

### Option B: Next.js (Full-Stack)

```bash
cd nextjs-app
npm install
cp .env.example .env.local
# Edit .env.local with FACILITATOR_URL, MERCHANT_API_KEY, and NETWORK
npm run dev
```

Pay for `http://localhost:3000/api/premium-content` with the `basic-express` client (`RESOURCE_URL=http://localhost:3000/api/premium-content npm run client`).

### Option C: React Client (Frontend Only)

The `react-client` directory is a guide: follow its README to pay from the browser with `@x402/fetch` and a wagmi wallet. It needs a backend protected by x402, such as Option A.

## 3. Test Payment Flow

1. **Get Test USDC**
   - Get test USDC on Arbitrum Sepolia (Circle's faucet)
   - No USDC approval is needed: payments use EIP-3009 signatures

2. **Make Payment**
   - The client requests the resource and gets a 402 with `PAYMENT-REQUIRED`
   - It signs an EIP-3009 authorization to the facilitator's address
   - It retries with `PAYMENT-SIGNATURE`; the server verifies and settles through the facilitator

3. **Access Content**
   - The response contains the content and a `PAYMENT-RESPONSE` header
   - `transaction` in that header is the payment tx; view it on the block explorer

## 4. Integration Checklist

- [ ] Registered as merchant
- [ ] Saved API key securely
- [ ] Configured facilitator URL
- [ ] Backend uses `payTo` from the facilitator's `GET /supported`
- [ ] Backend returns 402 with a `PAYMENT-REQUIRED` header (SDK middleware)
- [ ] Price covers the facilitator gas fee (0.10 USDC by default)
- [ ] Client uses `@x402/fetch` or `@x402/axios` to sign and retry
- [ ] Backend settles with facilitator using the API key
- [ ] Error handling implemented
- [ ] Tested on Arbitrum Sepolia

## 5. Go to Production

Before deploying to mainnet:

1. **Update Configuration**
   Set this in both the facilitator's `.env` and your app's `.env` (they must match):
   ```env
   NETWORK=eip155:42161
   ```
   Arbitrum One USDC (`0xaf88d065e77c8cC2239327C5EDb3A432268e5831`) is the facilitator's default for that network.

2. **Security Review**
   - API key stored in environment variables
   - Never exposed to client
   - HTTPS only in production
   - Rate limiting enabled

3. **Test Thoroughly**
   - Test with small amounts first
   - Verify fee calculations
   - Test error scenarios
   - Monitor transactions

## Troubleshooting

### Issue: Merchant not approved
Wait for admin approval after registration.

### Issue: `invalid_exact_evm_signature`
Ensure the requirements carry `extra.name: "USD Coin"` and `extra.version: "2"` and that the client signs on the right chain.

### Issue: `invalid_exact_evm_recipient_mismatch`
`payTo` must be the facilitator's signer address from `GET /supported`, not your merchant address.

### Issue: `invalid_exact_evm_nonce_already_used`
The authorization was already settled. The SDK generates a fresh nonce per payment; don't replay old payloads.

### Issue: `amount_below_facilitator_fee`
Raise the price above the facilitator's gas fee (0.10 USDC by default).

### Issue: `insufficient_funds`
The payer needs USDC in their wallet.

## Next Steps

- Read the [Integration Walkthrough](./INTEGRATION_WALKTHROUGH.md)
- Review the [Authentication Guide](../docs/AUTHENTICATION_GUIDE.md)
- Join our Discord for support

## Resources

- [Main Documentation](../README.md)
- [API Reference](../docs/INTEGRATION_GUIDE.md)
- [GitHub Repository](https://github.com/hummusonrails/x402-facilitator)
