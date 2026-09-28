-- Migration 006: Bazaar discovery index
-- Resources advertised through the x402 `bazaar` extension. A row is written only
-- when a payment carrying the declaration has confirmed onchain (see settle.ts), so
-- nothing appears in GET /discovery/resources unless it has actually been paid for.

CREATE TABLE IF NOT EXISTS discovery_resources (
  id bigserial PRIMARY KEY,
  resource_url text NOT NULL,                        -- canonical URL (origin + routeTemplate or path)
  resource_type text NOT NULL CHECK (resource_type IN ('http', 'mcp')),
  tool_name text NOT NULL DEFAULT '',                -- MCP tool name; empty for http. Spec keys MCP entries on (url, toolName)
  x402_version integer NOT NULL,
  accepts jsonb NOT NULL,                            -- PaymentRequirements[] as advertised by the resource server
  metadata jsonb NOT NULL,                           -- discovery blob: extensions echo, description, mimeType, serviceName, tags, iconUrl, method, routeTemplate
  merchant_address bytea NOT NULL,                   -- merchant whose API key settled the payment
  pay_to text NOT NULL,                              -- lowercased accepts[0].payTo, for the payTo filter
  scheme text NOT NULL,                              -- accepts[0].scheme
  network text NOT NULL,                             -- accepts[0].network (CAIP-2)
  last_nonce text NOT NULL,                          -- EIP-3009 nonce of the settlement that last refreshed the entry
  settle_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_updated timestamptz NOT NULL DEFAULT now(),
  UNIQUE (resource_url, tool_name)
);

-- GET /discovery/resources filters on these and orders by last_updated
CREATE INDEX IF NOT EXISTS discovery_resources_type_idx ON discovery_resources(resource_type);
CREATE INDEX IF NOT EXISTS discovery_resources_pay_to_idx ON discovery_resources(pay_to);
CREATE INDEX IF NOT EXISTS discovery_resources_network_scheme_idx ON discovery_resources(network, scheme);
CREATE INDEX IF NOT EXISTS discovery_resources_merchant_idx ON discovery_resources(merchant_address);
CREATE INDEX IF NOT EXISTS discovery_resources_last_updated_idx ON discovery_resources(last_updated DESC);

COMMENT ON TABLE discovery_resources IS 'x402 bazaar discovery catalog, populated on confirmed settlement only';
COMMENT ON COLUMN discovery_resources.metadata IS 'Discovery metadata echoed from the paying client: extensions, description, mimeType, serviceName, tags, iconUrl, method, routeTemplate';
COMMENT ON COLUMN discovery_resources.last_nonce IS 'Nonce of the confirmed payment that last upserted this row (provenance)';
