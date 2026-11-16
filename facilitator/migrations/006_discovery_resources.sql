-- Migration 006: Bazaar discovery index
-- Resources advertised through the x402 `bazaar` extension. A row is written only
-- when a payment carrying the declaration has confirmed onchain (see settle.ts), so
-- nothing appears in GET /discovery/resources unless it has actually been paid for.
--
-- Trust boundary: the declaration and resource URL come from the paying client's
-- payload. A row records that a declaration accompanied a confirmed payment to the
-- merchant in merchant_address; it does not attest that anyone controls the URL.
-- The first merchant to index a (resource_url, tool_name) owns the row: later
-- settlements by other merchants for the same key are rejected, never merged.

CREATE TABLE IF NOT EXISTS discovery_resources (
  id bigserial PRIMARY KEY,
  resource_url text NOT NULL,                        -- canonical URL (origin + routeTemplate or path)
  resource_type text NOT NULL CHECK (resource_type IN ('http', 'mcp')),
  tool_name text NOT NULL DEFAULT '',                -- MCP tool name; empty for http. Spec keys MCP entries on (url, toolName)
  x402_version integer NOT NULL,
  accepts jsonb NOT NULL,                            -- PaymentRequirements[]: the requirement from the most recent confirmed settlement (replaced, not accumulated, so stale terms never stay discoverable)
  metadata jsonb NOT NULL,                           -- discovery blob: the bazaar declaration, description, mimeType, serviceName, tags, iconUrl
  merchant_address bytea NOT NULL,                   -- owning merchant: whose API key settled the first indexed payment
  last_nonce text NOT NULL,                          -- EIP-3009 nonce of the settlement that last refreshed the entry
  settle_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_updated timestamptz NOT NULL DEFAULT now(),
  UNIQUE (resource_url, tool_name)
);

-- GET /discovery/resources filters by type and by fields inside accepts (network, scheme, payTo), orders by last_updated
CREATE INDEX IF NOT EXISTS discovery_resources_type_idx ON discovery_resources(resource_type);
CREATE INDEX IF NOT EXISTS discovery_resources_accepts_gin_idx ON discovery_resources USING gin (accepts jsonb_path_ops);
CREATE INDEX IF NOT EXISTS discovery_resources_merchant_idx ON discovery_resources(merchant_address);
CREATE INDEX IF NOT EXISTS discovery_resources_last_updated_idx ON discovery_resources(last_updated DESC);

COMMENT ON TABLE discovery_resources IS 'x402 bazaar discovery catalog, populated on confirmed settlement only; first indexing merchant owns the row';
COMMENT ON COLUMN discovery_resources.accepts IS 'PaymentRequirements from the most recent confirmed settlement (each settlement carries the one requirement the buyer chose); replaced on each update so the catalog never advertises superseded terms';
COMMENT ON COLUMN discovery_resources.metadata IS 'Discovery metadata echoed from the paying client: the bazaar declaration, description (capped), mimeType (capped), serviceName, tags, iconUrl';
COMMENT ON COLUMN discovery_resources.merchant_address IS 'Merchant whose API key settled the first indexed payment; only this merchant can update the row';
COMMENT ON COLUMN discovery_resources.last_nonce IS 'Nonce of the confirmed payment that last upserted this row (provenance)';
