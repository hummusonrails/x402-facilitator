# Auto-Discovery Pattern

The facilitator supports auto-discovery of its wallet address via the `/health` endpoint.

## Usage

### JavaScript/TypeScript

```typescript
// Fetch facilitator configuration
async function getFacilitatorConfig(facilitatorUrl: string) {
  const response = await fetch(`${facilitatorUrl}/health`);
  const health = await response.json();
  
  return {
    address: health.facilitatorAddress,
    network: health.network,
    chainId: health.chainId,
  };
}

// Use in your app
const FACILITATOR_URL = 'https://facilitator.example.com';
const config = await getFacilitatorConfig(FACILITATOR_URL);

// Now use config.address in payment requirements
const paymentRequirements = {
  recipient: config.address, // ← Fetched dynamically
  merchantAddress: YOUR_MERCHANT_ADDRESS,
  amount: '1000000',
  // ...
};
```

### cURL

```bash
# Get facilitator info
curl https://facilitator.example.com/health

# Response
{
  "status": "ok",
  "network": "arbitrum-sepolia",
  "chainId": 421614,
  "facilitatorAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  "timestamp": 1699000000000
}
```

## Example Integration

```typescript
import express from 'express';

const app = express();
const FACILITATOR_URL = process.env.FACILITATOR_URL;

// Cache facilitator config at startup
let facilitatorConfig: {
  address: string;
  network: string;
  chainId: number;
} | null = null;

async function initializeFacilitator() {
  try {
    const response = await fetch(`${FACILITATOR_URL}/health`);
    const health = await response.json();
    
    facilitatorConfig = {
      address: health.facilitatorAddress,
      network: health.network,
      chainId: health.chainId,
    };
    
    console.log('✓ Facilitator initialized:', facilitatorConfig);
  } catch (error) {
    console.error('✗ Failed to initialize facilitator:', error);
    process.exit(1);
  }
}

// Initialize before starting server
initializeFacilitator().then(() => {
  app.listen(3000, () => {
    console.log('Server started');
  });
});

// Use in routes
app.get('/api/premium-content', (req, res) => {
  if (!facilitatorConfig) {
    return res.status(503).json({ error: 'Facilitator not initialized' });
  }
  
  const paymentRequirements = {
    recipient: facilitatorConfig.address, // ← Dynamic
    merchantAddress: YOUR_MERCHANT_ADDRESS,
    amount: '1000000',
    network: facilitatorConfig.network,
    // ...
  };
  
  res.status(402).json({
    error: 'Payment required',
    paymentRequirements,
  });
});
```

## Caching Recommendations

- **Cache at startup**: Fetch once when your app starts
- **TTL**: Facilitator address rarely changes, 24-hour cache is fine
- **Refresh on error**: If settlement fails with "invalid recipient", refresh cache
- **Health check**: Optionally revalidate periodically