import { pool } from './db.js';
import { createLogger } from './logging.js';

const logger = createLogger({ context: 'discoveryStore' });

export type DiscoveryResourceType = 'http' | 'mcp';

/** Metadata kept alongside a catalog entry. Mirrors the optional fields of a bazaar DiscoveryResource. */
export interface DiscoveryMetadata {
  description?: string;
  mimeType?: string;
  serviceName?: string;
  tags?: string[];
  iconUrl?: string;
  /** The `bazaar` declaration only, not the buyer's whole `paymentPayload.extensions` map */
  extensions?: Record<string, unknown>;
}

export interface DiscoveryUpsert {
  resourceUrl: string;
  type: DiscoveryResourceType;
  toolName?: string;
  x402Version: number;
  /** The one PaymentRequirements the settled payment used; becomes the row's `accepts` */
  requirement: unknown;
  metadata: DiscoveryMetadata;
  merchantAddress: `0x${string}`;
  nonce: string;
}

export type UpsertOutcome = 'inserted' | 'updated' | 'claimed_by_other';

/** Wire shape of one item in GET /discovery/resources, matching the bazaar DiscoveryResource type. */
export interface DiscoveryItem {
  resource: string;
  type: DiscoveryResourceType;
  x402Version: number;
  accepts: unknown[];
  lastUpdated: string;
  description?: string;
  mimeType?: string;
  serviceName?: string;
  tags?: string[];
  iconUrl?: string;
  extensions?: Record<string, unknown>;
}

export interface DiscoveryQuery {
  type?: DiscoveryResourceType;
  payTo?: string;
  scheme?: string;
  network?: string;
  limit: number;
  offset: number;
}

/**
 * Insert or refresh a catalog entry. Keyed on (resource_url, tool_name) so an MCP
 * endpoint that serves several tools gets one row per tool, as the spec requires.
 *
 * Ownership: the merchant whose payment first indexed a key owns the row. A later
 * settlement by a different merchant for the same key changes nothing and reports
 * `claimed_by_other`, so one cheap payment cannot rewrite another merchant's price,
 * payTo or metadata. First writer wins; the facilitator cannot verify URL control.
 *
 * `accepts` is replaced, not accumulated. Each settlement carries the single
 * requirement the buyer chose, and the newest one wins, so the catalog always
 * advertises the terms the resource most recently settled on. Accumulating would
 * keep stale prices discoverable: an agent reading a superseded entry would sign
 * an authorization the resource server's own 402 no longer accepts.
 *
 * Callers must only invoke this after the payment carrying the declaration has confirmed.
 */
export async function upsertDiscoveryResource(args: DiscoveryUpsert): Promise<UpsertOutcome> {
  const requirementJson = JSON.stringify([args.requirement]);
  const { rows } = await pool.query(
    `INSERT INTO discovery_resources
       (resource_url, resource_type, tool_name, x402_version, accepts, metadata, merchant_address, last_nonce)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, decode(substr($7, 3), 'hex'), $8)
     ON CONFLICT (resource_url, tool_name) DO UPDATE SET
       x402_version = EXCLUDED.x402_version,
       accepts = EXCLUDED.accepts,
       metadata = EXCLUDED.metadata,
       last_nonce = EXCLUDED.last_nonce,
       settle_count = discovery_resources.settle_count + 1,
       last_updated = now()
     WHERE discovery_resources.merchant_address = EXCLUDED.merchant_address
     RETURNING (xmax = 0) AS inserted`,
    [
      args.resourceUrl,
      args.type,
      args.toolName ?? '',
      args.x402Version,
      requirementJson,
      JSON.stringify(args.metadata),
      args.merchantAddress,
      args.nonce,
    ]
  );

  // No row returned: the conflict target exists and belongs to a different merchant
  const outcome: UpsertOutcome = rows.length === 0 ? 'claimed_by_other' : rows[0].inserted ? 'inserted' : 'updated';

  if (outcome === 'claimed_by_other') {
    logger.warn('Discovery resource not indexed: key owned by another merchant', {
      resource: args.resourceUrl,
      type: args.type,
      toolName: args.toolName,
      merchant: args.merchantAddress,
    });
  } else {
    logger.info('Discovery resource indexed', {
      resource: args.resourceUrl,
      type: args.type,
      toolName: args.toolName,
      merchant: args.merchantAddress,
      outcome,
    });
  }
  return outcome;
}

function toItem(row: any): DiscoveryItem {
  const metadata: DiscoveryMetadata = row.metadata ?? {};
  return {
    resource: row.resource_url,
    type: row.resource_type,
    x402Version: row.x402_version,
    accepts: row.accepts,
    lastUpdated: new Date(row.last_updated).toISOString(),
    ...(metadata.description !== undefined && { description: metadata.description }),
    ...(metadata.mimeType !== undefined && { mimeType: metadata.mimeType }),
    ...(metadata.serviceName !== undefined && { serviceName: metadata.serviceName }),
    ...(metadata.tags !== undefined && { tags: metadata.tags }),
    ...(metadata.iconUrl !== undefined && { iconUrl: metadata.iconUrl }),
    ...(metadata.extensions !== undefined && { extensions: metadata.extensions }),
  };
}

/**
 * Page through the catalog, newest first. `network` and `scheme` match any entry in
 * `accepts` via jsonb containment (GIN indexed); `payTo` compares case-insensitively.
 * Returns the total matching count for `pagination.total`.
 */
export async function listDiscoveryResources(query: DiscoveryQuery): Promise<{ items: DiscoveryItem[]; total: number }> {
  const where: string[] = [];
  const values: any[] = [];

  if (query.type) {
    values.push(query.type);
    where.push(`resource_type = $${values.length}`);
  }
  if (query.network) {
    values.push(JSON.stringify([{ network: query.network }]));
    where.push(`accepts @> $${values.length}::jsonb`);
  }
  if (query.scheme) {
    values.push(JSON.stringify([{ scheme: query.scheme }]));
    where.push(`accepts @> $${values.length}::jsonb`);
  }
  if (query.payTo) {
    values.push(query.payTo.toLowerCase());
    where.push(`EXISTS (SELECT 1 FROM jsonb_array_elements(accepts) a WHERE lower(a->>'payTo') = $${values.length})`);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const filterValues = [...values];
  values.push(query.limit, query.offset);

  const { rows } = await pool.query(
    `SELECT resource_url, resource_type, x402_version, accepts, metadata, last_updated,
            count(*) OVER() AS total
     FROM discovery_resources
     ${whereSql}
     ORDER BY last_updated DESC, id DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  if (rows.length > 0) {
    return { items: rows.map(toItem), total: Number(rows[0].total) };
  }

  // Past the last page (or empty catalog): still report the true total
  const { rows: countRows } = await pool.query(`SELECT count(*) AS total FROM discovery_resources ${whereSql}`, filterValues);
  return { items: [], total: Number(countRows[0].total) };
}
