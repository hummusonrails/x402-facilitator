# React Client Example

How to pay for x402 v2 protected resources from a React app, using `@x402/fetch` with the user's connected wallet as the signer. Payments are EIP-3009 USDC authorizations settled by the Arbitrum facilitator.

This directory contains the `package.json` and this guide. Copy the snippets below into your own Vite/React app.

## Features

- Wallet connection with wagmi
- `@x402/fetch` handling the 402, signing, and retry automatically
- A wagmi wallet client adapted to the x402 `ClientEvmSigner` interface
- Reading the settlement result from the `PAYMENT-RESPONSE` header
- TypeScript support

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment:
```bash
cp .env.example .env.local
```

Edit `.env.local`:
```env
VITE_RESOURCE_URL=http://localhost:3000/api/premium-content
VITE_NETWORK=eip155:421614
```

The client never talks to the facilitator and needs no facilitator address or API key. It only calls your backend, which returns the payment requirements.

3. Start development server:
```bash
npm run dev
```

## Code

### Adapt the wagmi wallet client

`ExactEvmScheme` takes a `ClientEvmSigner` (`address` plus `signTypedData`). A local viem account already fits; a wagmi wallet client needs a small adapter:

```typescript
import type { ClientEvmSigner } from '@x402/evm';
import type { Account, WalletClient } from 'viem';

export function toX402Signer(walletClient: WalletClient): ClientEvmSigner {
  const account = walletClient.account as Account;
  return {
    address: account.address,
    signTypedData: (message) =>
      walletClient.signTypedData({
        account,
        domain: message.domain,
        types: message.types,
        primaryType: message.primaryType,
        message: message.message,
      } as Parameters<WalletClient['signTypedData']>[0]),
  };
}
```

### Pay for a resource

```tsx
import { useState } from 'react';
import { useWalletClient } from 'wagmi';
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm';
import { toX402Signer } from './toX402Signer';

const RESOURCE_URL = import.meta.env.VITE_RESOURCE_URL;
const NETWORK = import.meta.env.VITE_NETWORK as `${string}:${string}`;

export function PurchaseButton() {
  const { data: walletClient } = useWalletClient();
  const [status, setStatus] = useState('');

  async function purchase() {
    if (!walletClient) return;

    const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
      schemes: [{ network: NETWORK, client: new ExactEvmScheme(toX402Signer(walletClient)) }],
    });

    // 402 -> wallet signature prompt -> retry with PAYMENT-SIGNATURE
    const response = await fetchWithPayment(RESOURCE_URL);
    const content = await response.json();

    const header = response.headers.get('PAYMENT-RESPONSE');
    const settlement = header ? decodePaymentResponseHeader(header) : undefined;
    setStatus(settlement?.success ? `Paid in ${settlement.transaction}` : 'Payment failed');
    console.log(content);
  }

  return (
    <div>
      <button onClick={purchase} disabled={!walletClient}>Purchase Content</button>
      <p>{status}</p>
    </div>
  );
}
```

If your backend is on a different origin, it must expose the x402 headers through CORS (`Access-Control-Expose-Headers: PAYMENT-REQUIRED, PAYMENT-RESPONSE` and allow the `PAYMENT-SIGNATURE` request header).

## Usage Flow

1. Connect a browser wallet to Arbitrum Sepolia (`eip155:421614`)
2. Request protected content from your backend
3. Backend returns `402` with a `PAYMENT-REQUIRED` header (`payTo` is the facilitator)
4. `@x402/fetch` asks the wallet to sign an EIP-3009 `TransferWithAuthorization` (no approval transaction, no gas for the user)
5. It retries with the signed payload in the `PAYMENT-SIGNATURE` header
6. Backend verifies and settles with the facilitator
7. Content is returned with a `PAYMENT-RESPONSE` header holding the transaction hash

## Backend Required

This client requires a backend protected by x402 middleware, like the [Express](../basic-express/) or [Next.js](../nextjs-app/) examples, to:
- Return 402 responses with the `PAYMENT-REQUIRED` header
- Verify and settle payments with the facilitator using the merchant API key
- Return protected content after payment

## Learn More

- [React Documentation](https://react.dev)
- [wagmi Documentation](https://wagmi.sh)
- [viem Documentation](https://viem.sh)
- [`@x402/fetch` README](https://github.com/x402-foundation/x402/tree/main/typescript/packages/http/fetch)
