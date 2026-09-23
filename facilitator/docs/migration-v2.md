# x402 Facilitator Migration Notes

The facilitator follows the current [x402 v2 specification](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md) (the canonical repository moved from `coinbase/x402` to `x402-foundation/x402`) and works with the official `@x402/*` SDKs at 2.27.0. v1 payloads are still accepted.

## Breaking changes for integrators

### `POST /verify` and `POST /settle`
- Request body is the spec shape: `{ x402Version, paymentPayload, paymentRequirements }`. The EVM payload is `{ signature, authorization: { from, to, value, validAfter, validBefore, nonce } }`.
- The previous custom format (`network`, `token`, `recipient`, `amount`, `nonce`, `deadline`, `permit.sig`) is no longer accepted.
- The facilitator no longer reads `PAYMENT-SIGNATURE` or `X-PAYMENT` headers. Those travel between buyer and resource server; the resource server forwards the decoded payload in the body.
- `/verify` returns `{ isValid, invalidReason?, invalidMessage?, payer }` instead of `{ valid, reason, meta }`.
- `/settle` returns `{ success, errorReason?, errorMessage?, payer, transaction, network, amount, extra }`. `transaction` is the buyer's `transferWithAuthorization`. Fee details and the forward to the merchant moved into `extra` (`merchantAddress`, `forward`, `feeBreakdown`). The old top-level `txHash`, `meta`, `transactionHash`, `incomingTransactionHash`, `outgoingTransactionHash`, `blockNumber`, `status`, `feeBreakdown`, and `error` fields are gone.
- Business failures return 200 with `isValid: false` or `success: false`; malformed requests return 400. Error reasons are the spec and reference facilitator codes (see the README).
- `/verify` no longer requires `extra.merchantAddress`. The merchant is identified by the API key on `/settle`.

### `GET /supported`
- Returns `{ kinds, extensions, signers }` per the spec. `signers["eip155:*"][0]` is the facilitator address and the required `payTo`.
- Only the network this instance is configured for is listed.
- `versions`, `signingAddresses`, and `kinds[].payTo` were removed.

### `GET/POST /requirements`
- Returns 200 (previously 402) with a spec `PaymentRequired` object, and the same object base64 encoded in `PAYMENT-REQUIRED`. It no longer sets `PAYMENT-RESPONSE` / `X-PAYMENT-RESPONSE`, which the spec reserves for settlement results.
- v2 requirements use `amount` (not `maxAmountRequired`), carry `resource` at the top level, and include the EIP-712 domain `extra.name` / `extra.version` that clients need to sign.
- `maxTimeoutSeconds` defaults to 300 and `extra.nonce` / `extra.deadline` were removed (the client generates the nonce).

## Behavior changes
- `/verify` is read-only as the spec requires. Previously it recorded the nonce, which made a verify followed by settle fail.
- Verification now checks balance, onchain nonce state, and simulates the transfer. Signatures are checked the way USDC checks them onchain, so EIP-1271 smart wallets and EIP-7702 delegated EOAs are handled correctly.
- The authorized value must equal `amount` exactly.
- Settlement confirms the USDC `Transfer` event. If the receipt does not arrive within `SETTLEMENT_CONFIRMATION_TIMEOUT_MS`, `/settle` returns `settlement_pending` with the transaction hash, and a retry of the same payload reconciles against it.
- If the buyer's payment lands but the forward to the merchant fails, `/settle` still reports success (the payment is settled) with `extra.forward.status: "pending"`, and the recovery worker retries the forward.
- Verify and settle now use the same fee split calculation. Previously `/settle` recomputed fees differently and could reject valid amounts.

## Operator steps
1. Set `NETWORK` to `eip155:42161` or `eip155:421614` (legacy names still work) and confirm the RPC URL.
2. Optionally set `SETTLEMENT_CONFIRMATION_TIMEOUT_MS` (default 180000). `ALLOW_CLIENT_RECIPIENT` was unused and has been removed.
3. Point resource servers at the official SDK: `HTTPFacilitatorClient` from `@x402/core/server` with `createAuthHeaders` returning `{ verify: {}, settle: { "X-API-Key": key }, supported: {} }`. See `x402-examples/basic-express`.
