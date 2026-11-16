-- Migration 007: Bazaar discovery origin registration
-- The catalogued URL (origin + routeTemplate) comes from the paying client, so on its
-- own it proves nothing about who serves it. From this migration on, a resource is only
-- indexed when an operator has registered its origin to the merchant whose API key
-- settled the payment (pnpm discovery origins add <merchant> <origin>). One merchant per
-- origin: a marketplace serving several merchants behind one origin cannot be expressed,
-- deliberately, since path is not part of an origin.
--
-- Additive only: no existing catalog row is deleted by applying this migration. Rows are
-- removed afterwards, by the triggers below, only when an operator changes a registration.
-- Idempotent, like 006: safe to re-run.

-- 1. Registrations: one merchant per origin
CREATE TABLE IF NOT EXISTS discovery_merchant_origins (
  origin text PRIMARY KEY,                           -- scheme://host[:port], exactly as URL.origin gives it
  merchant_address text NOT NULL REFERENCES merchants(address) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS discovery_merchant_origins_merchant_idx ON discovery_merchant_origins(merchant_address);

-- 2. Catalog rows carry their normalized origin. Deliberately no foreign key to the
-- registrations: backfilled rows on origins nobody has registered would violate it, and
-- the migration would have to delete them.
ALTER TABLE discovery_resources ADD COLUMN IF NOT EXISTS origin text;

-- Backfill as close to URL.origin as SQL gets: lowercase scheme and host, default port
-- dropped. Only plain ASCII hosts are normalized here (URL.origin punycodes the rest);
-- anything else keeps origin NULL, which the discovery script handles in TypeScript.
WITH parts AS (
  SELECT d.id, lower(m[1]) AS scheme, lower(m[2]) AS host, m[3] AS port
  FROM discovery_resources d,
       regexp_match(d.resource_url, '^([A-Za-z][A-Za-z0-9+.-]*)://([A-Za-z0-9.-]+)(?::([0-9]{1,5}))?(?:[/?#]|$)') AS m
  WHERE d.origin IS NULL
)
UPDATE discovery_resources d
SET origin = p.scheme || '://' || p.host ||
  CASE
    WHEN p.port IS NULL THEN ''
    WHEN p.scheme = 'https' AND p.port::int = 443 THEN ''
    WHEN p.scheme = 'http' AND p.port::int = 80 THEN ''
    ELSE ':' || p.port::int
  END
FROM parts p
WHERE d.id = p.id AND p.scheme IN ('http', 'https');

CREATE INDEX IF NOT EXISTS discovery_resources_origin_idx ON discovery_resources(origin);

-- 3. Catalog rows follow their registration. A registration that appears or moves clears
-- other merchants' rows on that origin, so leftovers never block the registered owner with
-- `resource claimed by another merchant`. A registration that goes, whether removed or
-- cascaded from a deleted merchant, takes every row on its origin with it.
CREATE OR REPLACE FUNCTION discovery_origin_registration_changed() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM discovery_resources WHERE origin = OLD.origin;
    RETURN OLD;
  END IF;
  -- merchants.address is text, discovery_resources.merchant_address is bytea; strip 0x only when present
  DELETE FROM discovery_resources
  WHERE origin = NEW.origin
    AND merchant_address <> decode(regexp_replace(lower(NEW.merchant_address), '^0x', ''), 'hex');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS discovery_origin_registered_or_removed ON discovery_merchant_origins;
CREATE TRIGGER discovery_origin_registered_or_removed
  AFTER INSERT OR DELETE ON discovery_merchant_origins
  FOR EACH ROW EXECUTE FUNCTION discovery_origin_registration_changed();

-- Only a move cascades; any other update (created_at, say) deletes nothing
DROP TRIGGER IF EXISTS discovery_origin_moved ON discovery_merchant_origins;
CREATE TRIGGER discovery_origin_moved
  AFTER UPDATE OF merchant_address ON discovery_merchant_origins
  FOR EACH ROW WHEN (OLD.merchant_address IS DISTINCT FROM NEW.merchant_address)
  EXECUTE FUNCTION discovery_origin_registration_changed();

COMMENT ON TABLE discovery_merchant_origins IS 'Origins an operator has registered to a merchant for Bazaar discovery; one merchant per origin. Only resources on an origin registered to the settling merchant are catalogued';
COMMENT ON COLUMN discovery_merchant_origins.origin IS 'scheme://host[:port] as URL.origin gives it (lowercase host, default port dropped)';
COMMENT ON COLUMN discovery_merchant_origins.merchant_address IS 'The merchant (merchants.address) allowed to catalogue resources on this origin';

-- 006's comments predate registration; bring them in line
COMMENT ON TABLE discovery_resources IS 'x402 bazaar discovery catalog, populated on confirmed settlement only, and only for origins an operator has registered to the settling merchant (discovery_merchant_origins). Does not attest URL control beyond that registration';
COMMENT ON COLUMN discovery_resources.merchant_address IS 'Merchant whose API key settled the indexed payment. Must hold the registration for the row''s origin; only this merchant can update the row';
COMMENT ON COLUMN discovery_resources.origin IS 'Normalized origin of resource_url, as URL.origin gives it; matched against discovery_merchant_origins. NULL only for pre-007 rows SQL could not normalize';
