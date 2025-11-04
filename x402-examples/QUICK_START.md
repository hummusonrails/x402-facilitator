# Quick Start Guide

Get started with x402 payments in 5 minutes.

## Prerequisites

- Node.js 18+
- MetaMask wallet
- Arbitrum Sepolia testnet ETH
- Test USDC on Arbitrum Sepolia
- Merchant account (register at facilitator dashboard)

## 1. Register as Merchant

Visit the facilitator dashboard and register:

```
http://your-facilitator.com/register
```

Save your API key securely - you'll never see it again!

## 2. Choose Your Example

### Option A: Basic Express (Simplest)

```bash
cd basic-express
npm install
cp .env.example .env
# Edit .env with your API key
npm start
```

Test it:
```bash
curl http://localhost:3000/api/premium-content
```

### Option B: Next.js (Full-Stack)

```bash
cd nextjs-app
npm install
cp .env.example .env.local
# Edit .env.local with your API key
npm run dev
```

Visit: http://localhost:3000

### Option C: React Client (Frontend Only)

Requires a backend server running.

```bash
cd react-client
npm install
cp .env.example .env
npm run dev
```

## 3. Test Payment Flow

1. **Get Test USDC**
   - Get Arbitrum Sepolia ETH from faucet
   - Get test USDC (ask in Discord or use Circle's faucet)

2. **Connect Wallet**
   - Open the example app
   - Connect MetaMask
   - Switch to Arbitrum Sepolia

3. **Make Payment**
   - Click "Purchase Content"
   - Approve USDC spending (if first time)
   - Sign the payment authorization
   - Wait for confirmation

4. **Access Content**
   - Content unlocks after payment
   - View transaction on block explorer

## 4. Integration Checklist

- [ ] Registered as merchant
- [ ] Saved API key securely
- [ ] Configured environment variables
- [ ] Backend returns 402 responses
- [ ] Client creates EIP-3009 signatures
- [ ] Backend settles with facilitator
- [ ] Error handling implemented
- [ ] Tested on Arbitrum Sepolia

## 5. Go to Production

Before deploying to mainnet:

1. **Update Configuration**
   ```env
   NETWORK=arbitrum
   USDC_ADDRESS=0xaf88d065e77c8cC2239327C5EDb3A432268e5831
   ```

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

### Issue: Invalid signature
Ensure correct EIP-712 domain for USDC.

### Issue: Nonce already used
Generate a new random nonce for each payment.

### Issue: Insufficient balance
User needs USDC in their wallet.

## Next Steps

- Read the [Integration Walkthrough](./INTEGRATION_WALKTHROUGH.md)
- Review [Security Best Practices](../docs/SECURITY.md)
- Join our Discord for support

## Resources

- [Main Documentation](../README.md)
- [API Reference](../docs/INTEGRATION_GUIDE.md)
- [GitHub Repository](https://github.com/hummusonrails/x402-facilitator)
