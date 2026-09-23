import { x402ResourceServer } from '@x402/next';
import type { Network } from '@x402/next';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';

const FACILITATOR_URL = process.env.FACILITATOR_URL ?? 'http://localhost:3002';
export const NETWORK = (process.env.NETWORK ?? 'eip155:421614') as Network;

const facilitatorClient = new HTTPFacilitatorClient({
  url: FACILITATOR_URL,
  // Keyed by facilitator endpoint; only /settle needs the merchant API key
  createAuthHeaders: async () => ({
    verify: {},
    settle: { 'X-API-Key': process.env.MERCHANT_API_KEY ?? '' },
    supported: {},
  }),
});

export const server = new x402ResourceServer(facilitatorClient).register(NETWORK, new ExactEvmScheme());

// Buyers pay the facilitator's signer address, and the facilitator forwards
// your share to the merchant address tied to your API key.
let cachedPayTo: string | undefined;

export async function facilitatorPayTo(): Promise<string> {
  if (cachedPayTo) {
    return cachedPayTo;
  }
  const response = await fetch(`${FACILITATOR_URL}/supported`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`GET /supported failed with ${response.status}`);
  }
  const supported = (await response.json()) as { signers?: Record<string, string[]> };
  const payTo = supported.signers?.['eip155:*']?.[0];
  if (!payTo) {
    throw new Error('Facilitator did not advertise an eip155 signer');
  }
  cachedPayTo = payTo;
  return payTo;
}
