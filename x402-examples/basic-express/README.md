# Basic Express Integration Example

An Express.js resource server paid through the Arbitrum x402 facilitator, plus a client that pays for it. Both use the official x402 v2 SDKs from [x402-foundation/x402](https://github.com/x402-foundation/x402).

## Features

- `@x402/express` `paymentMiddleware` protecting `GET /api/premium-content` for `$0.50`
- `HTTPFacilitatorClient` pointed at the facilitator, sending the merchant API key only on `/settle`
- `payTo` read from the facilitator's `GET /supported` (fee split model: buyers pay the facilitator, which forwards your share)
- A paying client built with `@x402/fetch` that prints the settlement result

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables:
```bash
cp .env.example .env
```

Edit `.env` with your values:
```env
# Facilitator this server settles through
FACILITATOR_URL=http://localhost:3002
# API key issued to your merchant account (sent only on /settle)
MERCHANT_API_KEY=your_api_key_here
# Must match the facilitator's NETWORK: eip155:421614 (Arbitrum Sepolia) or eip155:42161 (Arbitrum One)
NETWORK=eip155:421614
PORT=3000

# Only used by `npm run client`: a funded test wallet that pays for the request
PAYER_PRIVATE_KEY=0xYourTestWalletPrivateKey
RESOURCE_URL=http://localhost:3000/api/premium-content
```

There is no merchant address setting: the facilitator forwards your share to the address registered for your API key.

3. Start the server:
```bash
npm start
```

On startup it prints the facilitator address it will use as `payTo`.

## Usage

### 1. Request without paying

```bash
curl -i http://localhost:3000/api/premium-content
```

The server responds `402 Payment Required` with a `PAYMENT-REQUIRED` header. Decoded from base64, it looks like:

```json
{
  "x402Version": 2,
  "error": "Payment required",
  "resource": {
    "url": "http://localhost:3000/api/premium-content",
    "description": "Access to premium content",
    "mimeType": "application/json"
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:421614",
      "amount": "500000",
      "asset": "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
      "payTo": "0xFacilitatorAddress",
      "maxTimeoutSeconds": 300,
      "extra": { "name": "USD Coin", "version": "2" }
    }
  ]
}
```

### 2. Pay with the client

```bash
npm run client
```

`src/client.js` wraps `fetch` with `wrapFetchWithPaymentFromConfig`. It reads the 402, signs an EIP-3009 authorization to the facilitator with `PAYER_PRIVATE_KEY`, and retries with the `PAYMENT-SIGNATURE` header. The server verifies with the facilitator, runs the route handler, settles, and returns the content with a `PAYMENT-RESPONSE` header. The client decodes it:

```json
{
  "success": true,
  "payer": "0xPayerAddress",
  "transaction": "0xPAYER_TRANSFER_TX_HASH",
  "network": "eip155:421614",
  "amount": "500000",
  "extra": {
    "merchantAddress": "0xYourMerchantAddress",
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

The payer wallet needs at least 0.50 test USDC. It does not need ETH; the facilitator pays gas.

## File Structure

```
basic-express/
├── README.md
├── package.json
├── .env.example
└── src/
    ├── index.js    # Resource server with paymentMiddleware
    └── client.js   # Paying client (npm run client)
```

## Scripts

- `npm start`: run the server
- `npm run dev`: run the server with `--watch`
- `npm run client`: pay for `RESOURCE_URL` once and print the result

## Next Steps

- Review the [full integration guide](../../docs/INTEGRATION_GUIDE.md)
- Explore the [Next.js example](../nextjs-app/) for a full-stack implementation
- Check out the [React client example](../react-client/) for frontend integration
