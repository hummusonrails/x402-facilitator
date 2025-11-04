const express = require('express');
const router = express.Router();

const CONTENT_PRICE = '1000000';

async function settlePayment(paymentPayload, paymentRequirements) {
  const response = await fetch(`${process.env.FACILITATOR_URL}/settle`, {
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

router.get('/premium-content', (req, res) => {
  const paymentRequirements = {
    merchantAddress: process.env.MERCHANT_ADDRESS,
    amount: CONTENT_PRICE,
    description: 'Access to premium content',
  };

  res.status(402).json({
    error: 'Payment required',
    paymentRequirements,
  });
});

router.post('/premium-content', async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body;

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
