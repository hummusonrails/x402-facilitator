# Basic Express Integration Example

A simple Express.js server demonstrating x402 payment integration.

## Features

- Express.js backend with x402 payment flow
- Protected API endpoint requiring payment
- Automatic payment verification and settlement
- Error handling and logging

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
FACILITATOR_URL=https://your-facilitator.com
MERCHANT_API_KEY=your_api_key_here
MERCHANT_ADDRESS=0xYourMerchantAddress
PORT=3000
```

3. Start the server:
```bash
npm start
```

## Usage

### 1. Request Protected Resource

Make a GET request to a protected endpoint:

```bash
curl http://localhost:3000/api/premium-content
```

Response (402 Payment Required):
```json
{
  "error": "Payment required",
  "paymentRequirements": {
    "merchantAddress": "0x...",
    "amount": "1000000",
    "description": "Access to premium content"
  }
}
```

### 2. Client Creates Payment

Client uses the payment requirements to create an EIP-3009 signature.

### 3. Submit Payment

Client sends payment payload back to your server:

```bash
curl -X POST http://localhost:3000/api/premium-content \
  -H "Content-Type: application/json" \
  -d '{
    "paymentPayload": { ... },
    "paymentRequirements": { ... }
  }'
```

### 4. Access Granted

Server verifies and settles payment, then returns the protected content.

## File Structure

```
basic-express/
├── README.md
├── package.json
├── .env.example
├── src/
│   ├── index.js          # Main server
│   ├── routes/
│   │   └── content.js    # Protected content routes
│   └── middleware/
│       └── payment.js    # Payment middleware
└── test/
    └── integration.test.js
```

## Testing

Run the test suite:

```bash
npm test
```

## Next Steps

- Review the [full integration guide](../../docs/INTEGRATION_GUIDE.md)
- Explore the [Next.js example](../nextjs-app/) for a full-stack implementation
- Check out the [React client example](../react-client/) for frontend integration
