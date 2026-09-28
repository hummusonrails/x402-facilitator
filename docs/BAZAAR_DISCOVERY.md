# Bazaar discovery: architecture

How the facilitator's [`bazaar` extension](https://docs.x402.org/extensions/bazaar) fits together with a
resource server that sells through it. The seller shown is
[notaxyz/bazaar-seller](https://github.com/notaxyz/bazaar-seller), an Arbitrum One contract-analysis API;
any x402 resource server that declares the extension works the same way.

## Components

```mermaid
flowchart LR
  subgraph Buyer["Buyer / Agent  (npm run agent)"]
    A1["withBazaar(HTTPFacilitatorClient)<br/>listResources()"]
    A2["wrapFetchWithPayment<br/>ExactEvmScheme(buyer key)"]
  end

  subgraph Seller["bazaar-seller  :3100  (Express + TS)"]
    S1["@x402/express paymentMiddleware<br/>GET /analyze  $0.25"]
    S2["declareDiscoveryExtension<br/>src/discovery.ts<br/>input example · input schema · output schema"]
    S3["analysis/analyze.ts<br/>proxy · source · control · token<br/>approvals · activity · risk flags"]
    S4["analysis/rpc.ts<br/>viem → Arbitrum One RPC"]
    S5["analysis/arbiscan.ts<br/>Etherscan V2 API chainid 42161"]
    S1 --> S3
    S2 -. "extensions.bazaar in 402" .- S1
    S3 --> S4
    S3 --> S5
  end

  subgraph Fac["x402-facilitator fork  :3002"]
    F0["/supported<br/>extensions: [bazaar]"]
    F1["/verify"]
    F2["/settle  (X-API-Key)"]
    F3["bazaar.ts<br/>evaluate · index · header"]
    F4["settle.ts<br/>onIncomingConfirmed hook"]
    F5["discoveryStore.ts"]
    F6["/discovery/resources"]
    F1 --> F3
    F2 --> F3
    F2 --> F4
    F4 -- "only after tx confirmed" --> F3
    F3 --> F5
    F6 --> F5
  end

  subgraph Data["Postgres (docker)"]
    D1[("payments · payment_events<br/>merchants")]
    D2[("discovery_resources<br/>migration 006")]
  end

  subgraph Chains
    C1["Arbitrum Sepolia<br/>USDC EIP-3009<br/>(payments)"]
    C2["Arbitrum One<br/>(data being sold)"]
  end

  A1 -- "1. GET /discovery/resources" --> F6
  A2 -- "2. GET /analyze → 402" --> S1
  A2 -- "3. retry with PAYMENT-SIGNATURE<br/>(echoes extensions.bazaar)" --> S1
  S1 -- "4. POST /verify" --> F1
  S1 -- "6. POST /settle" --> F2
  F1 -. "EXTENSION-RESPONSES: processing | rejected" .-> S1
  F2 -. "EXTENSION-RESPONSES: success | processing | rejected" .-> S1
  F4 -- "transferWithAuthorization<br/>+ merchant forward" --> C1
  F5 --> D2
  F4 --> D1
  S4 --> C2
  S1 -- "5. handler runs, 200 + analysis" --> A2
```

- **Buyer / agent**: any x402 client. Uses `withBazaar(new HTTPFacilitatorClient(...))` from `@x402/extensions`
  to read the catalog and `wrapFetchWithPayment` from `@x402/fetch` to pay.
- **Seller**: an `@x402/express` resource server. Declares how its paid route is called with
  `declareDiscoveryExtension`; the declaration rides along in every 402 it returns.
- **Facilitator**: this repository. `/verify` and `/settle` validate the declaration echoed in the payment payload
  (`src/bazaar.ts`), the settle hook indexes it once the payer's transfer has confirmed (`src/settle.ts`),
  and `GET /discovery/resources` serves the catalog (`src/discoveryStore.ts`, migration
  `006_discovery_resources.sql`).
- **Chains**: payments settle in USDC on the network the facilitator is configured for (Arbitrum Sepolia in
  development). The data the seller sells comes from Arbitrum One and never touches the payment path.

## One discovered, paid call

```mermaid
sequenceDiagram
  autonumber
  participant Agent as Buyer agent
  participant Fac as Facilitator :3002
  participant DB as Postgres
  participant Seller as bazaar-seller :3100
  participant Chain as Arbitrum Sepolia

  Agent->>Fac: GET /discovery/resources?type=http
  Fac->>DB: SELECT discovery_resources
  Fac-->>Agent: items[] (resource, accepts, extensions.bazaar.info)

  Agent->>Seller: GET /analyze?address=0x…
  Seller-->>Agent: 402 PAYMENT-REQUIRED (accepts, extensions.bazaar {info, schema})

  Note over Agent: sign EIP-3009 authorization<br/>echo extensions.bazaar into PaymentPayload
  Agent->>Seller: GET /analyze + PAYMENT-SIGNATURE

  Seller->>Fac: POST /verify {paymentPayload, paymentRequirements}
  Note over Fac: evaluateBazaarDeclaration()<br/>spec checks → info vs schema → URL/accepts
  Fac-->>Seller: 200 isValid + EXTENSION-RESPONSES {bazaar: processing}

  Seller->>Seller: analyzeContract() (Arbitrum One RPC + Etherscan V2)
  Seller-->>Agent: 200 analysis JSON

  Seller->>Fac: POST /settle (X-API-Key)
  Fac->>DB: claim nonce (advisory lock)
  Fac->>Chain: transferWithAuthorization(buyer → facilitator)
  Chain-->>Fac: receipt + Transfer event
  Fac->>DB: status = incoming_complete
  Note over Fac: onIncomingConfirmed hook →<br/>indexBazaarResource()
  Fac->>DB: UPSERT discovery_resources (resource_url, tool_name)
  Fac->>Chain: transfer(merchant share)
  Fac-->>Seller: 200 success, tx hashes + EXTENSION-RESPONSES {bazaar: success}
  Seller-->>Agent: PAYMENT-RESPONSE header (buyer never sees EXTENSION-RESPONSES)
```

1. The agent lists the catalog. Each item carries the resource URL, the price terms (`accepts`), and the seller's
   declaration (`extensions.bazaar.info`): method, example query parameters, output example.
2. The agent calls the route and receives a 402 whose `PAYMENT-REQUIRED` header repeats the declaration.
3. The client SDK signs an EIP-3009 authorization and echoes the declaration into `PaymentPayload.extensions`.
   This echo is how the declaration reaches the facilitator: the seller forwards the whole payload to `/verify`.
4. `/verify` validates the declaration (spec invariants, `info` against its own JSON Schema, absolute resource URL,
   well-formed `accepts`) and reports the outcome to the seller in the `EXTENSION-RESPONSES` header
   (`processing` or `rejected` with a reason). Payment verification is unaffected by the outcome.
5. The seller does the work and answers the buyer.
6. `/settle` submits `transferWithAuthorization`, waits for the receipt and the expected `Transfer` event, and only
   then upserts `discovery_resources`. The header reports `success`. A declaration attached to a payment that never
   lands is never indexed, so every catalog entry corresponds to a real settlement.

## Files

| Concern | File |
|---|---|
| Declaration validation, indexing, `EXTENSION-RESPONSES` | `facilitator/src/bazaar.ts` |
| Catalog table access | `facilitator/src/discoveryStore.ts` |
| Table definition | `facilitator/migrations/006_discovery_resources.sql` |
| Post-confirmation hook | `facilitator/src/settle.ts` (`SettleHooks.onIncomingConfirmed`) |
| Routes: `/supported`, `/verify`, `/settle`, `/discovery/resources` | `facilitator/src/server.ts` |
| Carrying `resource` and `extensions` through parsing | `facilitator/src/x402.ts`, `facilitator/src/types.ts` |
