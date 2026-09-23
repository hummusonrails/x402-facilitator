import 'dotenv/config';
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm';
import { privateKeyToAccount } from 'viem/accounts';

const RESOURCE_URL = process.env.RESOURCE_URL || 'http://localhost:3000/api/premium-content';
const NETWORK = process.env.NETWORK || 'eip155:421614';

if (!process.env.PAYER_PRIVATE_KEY) {
  console.error('PAYER_PRIVATE_KEY must be set to a funded test wallet');
  process.exit(1);
}

const account = privateKeyToAccount(process.env.PAYER_PRIVATE_KEY);

// Handles the 402, signs an EIP-3009 authorization, and retries with PAYMENT-SIGNATURE
const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: NETWORK, client: new ExactEvmScheme(account) }],
});

const response = await fetchWithPayment(RESOURCE_URL);
console.log('Status:', response.status);
console.log('Body:', await response.json());

const paymentResponse = response.headers.get('PAYMENT-RESPONSE');
if (paymentResponse) {
  console.log('Settlement:', decodePaymentResponseHeader(paymentResponse));
}
