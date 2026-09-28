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
  method?: string;
  routeTemplate?: string;
  /** Extension payloads echoed by the paying client (`paymentPayload.extensions`) */
  extensions?: Record<string, unknown>;
}

export interface DiscoveryUpsert {
  resourceUrl: string;
  type: DiscoveryResourceType;
  toolName?: string;
  x402Version: number;
  accepts: unknown[];
  metadata: DiscoveryMetadata;
  merchantAddress: `0x${string}`;
  payTo: string;
  scheme: string;
  network: string;
  nonce: string;
}

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
 * Callers must only invoke this after the payment carrying the declaration has confirmed.
 */
export async function upsertDiscoveryResource(args: DiscoveryUpsert): Promise<'inserted' | 'updated'> {
  const { rows } = await pool.query(
    `INSERT INTO discovery_resources
       (resource_url, resource_type, tool_name, x402_version, accepts, metadata,
        merchant_address, pay_to, scheme, network, last_nonce)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, decode(substr($7, 3), 'hex'), $8, $9, $10, $11)
     ON CONFLICT (resource_url, tool_name) DO UPDATE SET
       x402_version = EXCLUDED.x402_version,
       accepts = EXCLUDED.accepts,
       metadata = EXCLUDED.metadata,
       merchant_address = EXCLUDED.merchant_address,
       pay_to = EXCLUDED.pay_to,
       scheme = EXCLUDED.scheme,
       network = EXCLUDED.network,
       last_nonce = EXCLUDED.last_nonce,
       settle_count = discovery_resources.settle_count + 1,
       last_updated = now()
     RETURNING (xmax = 0) AS inserted`,
    [
      args.resourceUrl,
      args.type,
      args.toolName ?? '',
      args.x402Version,
      JSON.stringify(args.accepts),
      JSON.stringify(args.metadata),
      args.merchantAddress,
      args.payTo.toLowerCase(),
      args.scheme,
      args.network,
      args.nonce,
    ]
  );

  const outcome = rows[0]?.inserted ? 'inserted' : 'updated';
  logger.info('Discovery resource indexed', {
    resource: args.resourceUrl,
    type: args.type,
    toolName: args.toolName,
    merchant: args.merchantAddress,
    outcome,
  });
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
 * Page through the catalog, newest first. Returns the total matching count so the
 * response can carry `pagination.total` as the bazaar client SDK expects.
 */
export async function listDiscoveryResources(query: DiscoveryQuery): Promise<{ items: DiscoveryItem[]; total: number }> {
  const where: string[] = [];
  const values: any[] = [];

  if (query.type) {
    values.push(query.type);
    where.push(`resource_type = $${values.length}`);
  }
  if (query.payTo) {
    values.push(query.payTo.toLowerCase());
    where.push(`pay_to = $${values.length}`);
  }
  if (query.scheme) {
    values.push(query.scheme);
    where.push(`scheme = $${values.length}`);
  }
  if (query.network) {
    values.push(query.network);
    where.push(`network = $${values.length}`);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
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
  const { rows: countRows } = await pool.query(
    `SELECT count(*) AS total FROM discovery_resources ${whereSql}`,
    values.slice(0, values.length - 2)
  );
  return { items: [], total: Number(countRows[0].total) };
}
