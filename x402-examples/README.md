# X402 Integration Examples

This directory contains examples demonstrating x402 v2 payment integration with the Arbitrum facilitator using the official `@x402/*` SDKs from [x402-foundation/x402](https://github.com/x402-foundation/x402).

## Integration Overview

Resource servers use the SDK middleware with an `HTTPFacilitatorClient` pointed at `FACILITATOR_URL`, sending the merchant API key only on `/settle`. Buyers pay the facilitator's signer address, read at startup from `GET /supported` (`signers["eip155:*"][0]`); the facilitator forwards the merchant share to the address tied to the API key.

The HTTP flow follows the spec: the server replies 402 with a `PAYMENT-REQUIRED` header, the client retries with `PAYMENT-SIGNATURE`, and the server returns `PAYMENT-RESPONSE` with the settlement result. Clients built with `@x402/fetch` or `@x402/axios` handle this automatically.

## Getting Started

**New to x402?** Start here:
- [Quick Start Guide](./QUICK_START.md): get running in 5 minutes
- [Integration Walkthrough](./INTEGRATION_WALKTHROUGH.md): step-by-step implementation guide

## Quick Start

1. Start the facilitator: `cd ../facilitator && pnpm dev`
2. Choose an example and follow its README
3. Configure the facilitator URL in environment variables; network IDs use CAIP-2 (`eip155:421614` for Arbitrum Sepolia, `eip155:42161` for Arbitrum One) and must match the facilitator's `NETWORK`

## Examples

### 1. Basic Integration (Node.js + Express)
**Best for:** Simple backend integration, API services

[View Example](./basic-express/)

A runnable Express.js server and client showing:
- `@x402/express` `paymentMiddleware` with the facilitator as `payTo`
- Settlement through the facilitator with a merchant API key
- A paying client built with `@x402/fetch`

### 2. Next.js Full-Stack App
**Best for:** Modern web applications, full-stack projects

[View Example](./nextjs-app/)

A README-only guide for Next.js with:
- `withX402` from `@x402/next` protecting an API route
- Dynamic `payTo` read from the facilitator
- TypeScript snippets

### 3. React Client
**Best for:** Frontend-only applications, SPAs

[View Example](./react-client/)

A README-only guide for a React frontend with:
- Wallet connection with wagmi
- `@x402/fetch` signing EIP-3009 authorizations with the connected wallet
- Reading the settlement result from `PAYMENT-RESPONSE`

## Quick Start

Each example includes:
- Environment configuration
- Step-by-step setup instructions
- Code for the server or client side (`basic-express` is fully runnable; `nextjs-app` and `react-client` are snippets in their READMEs)

## Prerequisites

- Node.js 18+
- Arbitrum Sepolia testnet access (`eip155:421614`)
- USDC on Arbitrum Sepolia (for testing)
- Merchant account with x402 facilitator

## Getting Started

1. **Register as Merchant**
   - Visit the facilitator dashboard
   - Complete registration form
   - Save your API key securely

2. **Choose an Example**
   - Pick the example that matches your stack
   - Follow the README in that directory

3. **Configure Environment**
   - Copy `.env.example` to `.env`
   - Add your merchant API key
   - Set facilitator URL

4. **Test on Sepolia**
   - Get test USDC
   - Run the example
   - Make a test payment (for `basic-express`, run `npm run client` with a funded test wallet)

5. **Deploy to Production**
   - Point at a facilitator running with `NETWORK=eip155:42161` (Arbitrum One)
   - Set `NETWORK=eip155:42161` in your app
   - Enable security features

## Documentation

- [Quick Start](./QUICK_START.md): 5-minute setup guide
- [Integration Walkthrough](./INTEGRATION_WALKTHROUGH.md): detailed implementation
- [Main Documentation](../README.md): full facilitator docs and API reference
- [Integration Guide](../docs/INTEGRATION_GUIDE.md): merchant integration
- [Authentication Guide](../docs/AUTHENTICATION_GUIDE.md): API keys and security
- [x402 specification](https://github.com/x402-foundation/x402/tree/main/specs)

## Support

For questions or issues:
- [GitHub Issues](https://github.com/hummusonrails/x402-facilitator/issues)
- [Main Documentation](../README.md)
- [Integration Guide](../docs/INTEGRATION_GUIDE.md)

## License

MIT
