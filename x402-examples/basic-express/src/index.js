import 'dotenv/config';
import express from 'express';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { HTTPFacilitatorClient } from '@x402/core/server';

const PORT = process.env.PORT || 3000;
const FACILITATOR_URL = process.env.FACILITATOR_URL;
const MERCHANT_API_KEY = process.env.MERCHANT_API_KEY;
const NETWORK = process.env.NETWORK || 'eip155:421614';

if (!FACILITATOR_URL || !MERCHANT_API_KEY) {
  console.error('FACILITATOR_URL and MERCHANT_API_KEY must be set');
  process.exit(1);
}

// This facilitator uses a fee split model: buyers pay the facilitator's signer
// address, and the facilitator forwards your share to the merchant address tied
// to your API key. Read that address from GET /supported.
async function getFacilitatorPayTo() {
  const response = await fetch(`${FACILITATOR_URL}/supported`);
  if (!response.ok) {
    throw new Error(`GET /supported failed with ${response.status}`);
  }
  const supported = await response.json();
  const payTo = supported.signers?.['eip155:*']?.[0];
  if (!payTo) {
    throw new Error('Facilitator did not advertise an eip155 signer');
  }
  return payTo;
}

const facilitatorClient = new HTTPFacilitatorClient({
  url: FACILITATOR_URL,
  // Only /settle requires the merchant API key
  createAuthHeaders: async () => ({
    verify: {},
    settle: { 'X-API-Key': MERCHANT_API_KEY },
    supported: {},
  }),
});

const resourceServer = new x402ResourceServer(facilitatorClient).register(NETWORK, new ExactEvmScheme());

const payTo = await getFacilitatorPayTo();

const app = express();

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use(
  paymentMiddleware(
    {
      'GET /api/premium-content': {
        accepts: {
          scheme: 'exact',
          // Must cover the facilitator's fixed gas fee (0.10 USDC by default)
          price: '$0.50',
          network: NETWORK,
          payTo,
        },
        description: 'Access to premium content',
        mimeType: 'application/json',
      },
    },
    resourceServer,
  ),
);

// Runs only after the payment has been verified; settlement happens after the response is produced
app.get('/api/premium-content', (req, res) => {
  res.json({
    title: 'Premium Content',
    body: 'This is the premium content you paid for!',
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Facilitator URL: ${FACILITATOR_URL}`);
  console.log(`Network: ${NETWORK}`);
  console.log(`payTo (facilitator): ${payTo}`);
});
