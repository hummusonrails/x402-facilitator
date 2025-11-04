# X402 Integration Examples

Complete integration examples for the x402 payment protocol on Arbitrum.

## Getting Started

**New to x402?** Start here:
- [Quick Start Guide](./QUICK_START.md) - Get running in 5 minutes
- [Integration Walkthrough](./INTEGRATION_WALKTHROUGH.md) - Step-by-step implementation guide

## Examples

### 1. Basic Integration (Node.js + Express)
**Best for:** Simple backend integration, API services

[View Example](./basic-express/)

A minimal Express.js server showing:
- 402 Payment Required responses
- Backend payment settlement
- Protected content delivery

### 2. Next.js Full-Stack App
**Best for:** Modern web applications, full-stack projects

[View Example](./nextjs-app/)

A complete Next.js application with:
- Client-side wallet integration
- Server-side payment processing
- TypeScript support
- Modern UI with Tailwind CSS

### 3. React Client
**Best for:** Frontend-only applications, SPAs

[View Example](./react-client/)

A React frontend demonstrating:
- Wallet connection with wagmi
- EIP-3009 signature creation
- Payment flow UI components

## Quick Start

Each example includes:
- Complete source code
- Environment configuration
- Step-by-step setup instructions
- Testing guide

## Prerequisites

- Node.js 18+
- Arbitrum Sepolia testnet access
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
   - Make a test payment

5. **Deploy to Production**
   - Update to Arbitrum mainnet
   - Use production USDC address
   - Enable security features

## Documentation

- [Quick Start](./QUICK_START.md) - 5-minute setup guide
- [Integration Walkthrough](./INTEGRATION_WALKTHROUGH.md) - Detailed implementation
- [Main Documentation](../README.md) - Full facilitator docs
- [Integration Guide](../docs/INTEGRATION_GUIDE.md) - API reference
- [Security Guide](../docs/SECURITY.md) - Best practices

## Support

For questions or issues:
- [GitHub Issues](https://github.com/hummusonrails/x402-facilitator/issues)
- [Main Documentation](../README.md)
- [Integration Guide](../docs/INTEGRATION_GUIDE.md)

## License

MIT
