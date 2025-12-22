# x402 Facilitator Migration Notes (V1 to V2)

This facilitator now ships with the V2 shapes by default while keeping a V1 compatibility path.

## What changed
- Dependencies moved to the `@x402` namespace (`@x402/core`), removing legacy `x402` and `@coinbase/x402`.
- Networks use CAIP-2 identifiers (`eip155:42161`, `eip155:421614`) internally. Legacy names (`arbitrum`, `arbitrum-sepolia`) are still accepted and converted.
- `/supported` now advertises both versions, includes settlement signing addresses, and flags supported extensions.
- `/requirements` defaults to V2 and emits the payload in the `PAYMENT-RESPONSE` header (a legacy `X-PAYMENT-RESPONSE` mirror is also set). Passing `version=1` or `x402Version: 1` returns the legacy structure.
- Verification and settlement normalize networks to CAIP-2 before validation so V1 and V2 payloads are accepted.

## Operator steps
1) Environment: set `NETWORK` to `eip155:42161` or `eip155:421614` (old names still work), confirm RPC URLs and USDC addresses match the network.
2) Client expectations: clients should read requirements from `PAYMENT-RESPONSE`; V1 clients can continue reading the body or `X-PAYMENT-RESPONSE`.
3) Capability discovery: integrators should prefer the V2 entries in `/supported` (look at `versions["2"]`) and the `signingAddresses.settlement` field.
4) Settlement flow: payment payloads may include either network format; they must still target the configured facilitator address and token.

## Testing checklist
- GET /supported returns both V1 and V2 entries with correct CAIP-2 IDs and facilitator address in `payTo`.
- GET/POST /requirements returns V2 by default and V1 when `version=1`, and headers include `PAYMENT-RESPONSE`.
- Verify and settle reject payments using unexpected recipients or tokens and accept both CAIP-2 and legacy network identifiers.
