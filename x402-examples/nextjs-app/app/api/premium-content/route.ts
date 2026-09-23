import { NextResponse } from 'next/server';
import { withX402 } from '@x402/next';
import { server, NETWORK, facilitatorPayTo } from '@/lib/x402';

async function handler() {
  return NextResponse.json({
    title: 'Premium Content',
    body: 'This is the premium content you paid for!',
    timestamp: new Date().toISOString(),
  });
}

// Verifies before the handler runs and settles only if it returns a status below 400
export const GET = withX402(
  handler,
  {
    accepts: {
      scheme: 'exact',
      // Must cover the facilitator's fixed gas fee (0.10 USDC by default)
      price: '$0.50',
      network: NETWORK,
      payTo: facilitatorPayTo,
    },
    description: 'Access to premium content',
    mimeType: 'application/json',
  },
  server,
);
