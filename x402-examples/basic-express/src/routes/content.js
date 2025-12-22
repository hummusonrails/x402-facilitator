const express = require('express');
const router = express.Router();

const CONTENT_PRICE = '1000000';
const FACILITATOR_URL = process.env.FACILITATOR_URL;
const MERCHANT_ADDRESS = process.env.MERCHANT_ADDRESS;

async function settlePayment(paymentPayload, paymentRequirements) {
  const response = await fetch(`${FACILITATOR_URL}/settle`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': process.env.MERCHANT_API_KEY,
    },
    body: JSON.stringify({
      paymentPayload,
      paymentRequirements,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Settlement failed');
  }

  return await response.json();
}

async function fetchRequirements() {
  const description = 'Access to premium content';
  const response = await fetch(`${FACILITATOR_URL}/requirements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: CONTENT_PRICE,
      extra: {
        description,
        merchantAddress: MERCHANT_ADDRESS,
      },
    }),
  });

  if (!response.ok) {
    let errorBody;
    try {
      errorBody = await response.json();
    } catch {
      errorBody = await response.text();
    }
    throw new Error(`Failed to fetch requirements (${response.status}): ${JSON.stringify(errorBody)}`);
  }

  return await response.json();
}

function parsePaymentRequest(req) {
  if (req.body && Object.keys(req.body).length > 0) {
    return req.body;
  }
  const headerPayload = req.header('PAYMENT-SIGNATURE') || req.header('X-PAYMENT');
  if (!headerPayload) {
    return null;
  }
  try {
    return JSON.parse(headerPayload);
  } catch {
    return null;
  }
}

router.get('/premium-content', (req, res) => {
  fetchRequirements().then((requirements) => {
    const serialized = JSON.stringify(requirements);
    res.set('PAYMENT-RESPONSE', serialized);
    res.set('X-PAYMENT-RESPONSE', serialized);
    res.status(402).json({
      error: 'Payment required',
      paymentRequirements: requirements,
    });
  }).catch((error) => {
    console.error('Failed to fetch requirements', error);
    res.status(500).json({ error: 'Failed to fetch payment requirements' });
  });
});

router.post('/premium-content', async (req, res) => {
  try {
    const parsed = parsePaymentRequest(req);
    const { paymentPayload, paymentRequirements } = parsed || {};

    if (!paymentPayload || !paymentRequirements) {
      return res.status(400).json({ error: 'Missing payment data' });
    }

    const result = await settlePayment(paymentPayload, paymentRequirements);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      success: true,
      content: {
        title: 'Premium Content',
        body: 'This is the premium content you paid for!',
        data: {
          secret: 'This is secret premium data',
          timestamp: new Date().toISOString(),
        },
      },
      payment: {
        transactionHash: result.outgoingTransactionHash,
        blockNumber: result.blockNumber,
      },
    });
  } catch (error) {
    console.error('Payment processing error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
