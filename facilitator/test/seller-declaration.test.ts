import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { encodePaymentRequiredHeader } from '@x402/core/http';
import { createLogger } from '../src/logging.js';
import { shutdownSchemaGuard } from '../src/schemaGuard.js';
import { MERCHANT, normalizedPayment, requirements, validBazaarDeclaration } from './fixtures.js';
import type { NormalizedPayment } from '../src/types.js';

// Hoisted above the imports: config.ts reads these when it is first loaded. The stub seller
// listens on 127.0.0.1, which the resource-URL screen refuses unless private hosts are allowed.
vi.hoisted(() => {
  process.env.DISCOVERY_ALLOW_PRIVATE_RESOURCE_URLS = 'true';
  process.env.DISCOVERY_SELLER_TIMEOUT_MS = '300';
});

// Which origins are registered to MERCHANT; the SQL is covered in discoveryStore.test.ts
let registered = true;
vi.mock('../src/discoveryStore.js', () => ({
  isOriginRegistered: async () => registered,
}));

const { evaluateBazaarDeclaration, REJECTED_ORIGIN_NOT_REGISTERED, REJECTED_UNSUPPORTED_METHOD } = await import('../src/bazaar.js');
const {
  probeSeller,
  resolveSellerDeclaration,
  REJECTED_SELLER_NO_BAZAAR,
  REJECTED_SELLER_NO_MATCHING_ACCEPTS,
} = await import('../src/sellerDeclaration.js');

const logger = createLogger({ context: 'test' });

const SELLER_DESCRIPTION = "the seller's own description";
const FORGED_DESCRIPTION = 'this API moved to evil.example';

/** Requests the stub seller received, by path, with the method used */
const hits: { path: string; method: string }[] = [];
/** Set when the client hung up on the streaming route before the body ended */
let streamClosedEarly = false;

let seller: Server;
let base: string;

function sellerHeader(overrides: { extensions?: unknown; accepts?: unknown[] } = {}) {
  return encodePaymentRequiredHeader({
    x402Version: 2,
    error: 'Payment required',
    resource: { url: `${base}/analyze`, description: SELLER_DESCRIPTION, mimeType: 'application/json' },
    accepts: (overrides.accepts ?? [requirements]) as any,
    extensions: (overrides.extensions ?? { bazaar: validBazaarDeclaration() }) as any,
  });
}

function handle(req: IncomingMessage, res: ServerResponse) {
  const path = new URL(req.url ?? '/', base).pathname;
  hits.push({ path, method: req.method ?? '' });
  switch (path) {
    case '/analyze':
      res.writeHead(402, { 'PAYMENT-REQUIRED': sellerHeader(), 'content-type': 'application/json' });
      return res.end('{}');
    case '/redirect':
      res.writeHead(302, { location: `${base}/analyze` });
      return res.end();
    case '/ok':
      res.writeHead(200, { 'PAYMENT-REQUIRED': sellerHeader() });
      return res.end('{}');
    case '/no-bazaar':
      res.writeHead(402, { 'PAYMENT-REQUIRED': sellerHeader({ extensions: {} }) });
      return res.end();
    case '/other-payto':
      res.writeHead(402, { 'PAYMENT-REQUIRED': sellerHeader({ accepts: [{ ...requirements, payTo: MERCHANT }] }) });
      return res.end();
    case '/other-price':
      res.writeHead(402, { 'PAYMENT-REQUIRED': sellerHeader({ accepts: [{ ...requirements, amount: '999' }] }) });
      return res.end();
    case '/stream': {
      // A body that never ends: a client that read it would hang until its timeout
      res.writeHead(402, { 'PAYMENT-REQUIRED': sellerHeader() });
      const timer = setInterval(() => res.write('x'.repeat(16 * 1024)), 5);
      res.on('close', () => {
        clearInterval(timer);
        if (!res.writableEnded) streamClosedEarly = true;
      });
      return;
    }
    case '/slow':
      return; // never answers
    default:
      res.writeHead(404);
      return res.end();
  }
}

beforeAll(async () => {
  seller = createServer(handle);
  await new Promise<void>((resolve) => seller.listen(0, '127.0.0.1', resolve));
  const address = seller.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  seller.closeAllConnections();
  await new Promise<void>((resolve) => seller.close(() => resolve()));
  await shutdownSchemaGuard();
});

beforeEach(() => {
  registered = true;
  hits.length = 0;
  streamClosedEarly = false;
});

/**
 * A buyer's payload for `path` on the stub seller, with the echo rewritten the way Ben's
 * review describes: `info` as advertised, everything else the buyer's own.
 */
function forgedPayment(path: string, info?: (info: any) => void): NormalizedPayment {
  const declaration = { ...validBazaarDeclaration(), routeTemplate: '/made-up/:id' };
  info?.(declaration.info);
  const payment = normalizedPayment(declaration, `${base}${path}`);
  payment.resource = { url: `${base}${path}`, description: FORGED_DESCRIPTION, mimeType: 'text/html' };
  (payment.raw.paymentPayload as any).resource = payment.resource;
  return payment;
}

async function resolve(path: string, info?: (info: any) => void) {
  const payment = forgedPayment(path, info);
  const echo = await evaluateBazaarDeclaration(payment, logger);
  if (!echo.declared || !echo.valid) return { echo, result: undefined };
  return { echo, result: await resolveSellerDeclaration(echo.resource, payment, MERCHANT, logger) };
}

describe("resolveSellerDeclaration: the catalogue comes from the seller's 402", () => {
  it("stores the seller's resource block, declaration and accepts entry, none of the buyer's echo", async () => {
    const { echo, result } = await resolve('/analyze');
    // The forged echo itself passes validation; that is the hole being closed
    expect(echo).toMatchObject({ valid: true, resource: { resourceUrl: `${base}/made-up/:id`, description: FORGED_DESCRIPTION } });

    expect(result?.kind).toBe('resolved');
    if (result?.kind !== 'resolved') throw new Error('expected resolved');
    expect(result.resource.description).toBe(SELLER_DESCRIPTION);
    expect(result.resource.mimeType).toBe('application/json');
    // No routeTemplate in the seller's declaration, so the catalogued URL is the seller's own
    expect(result.resource.resourceUrl).toBe(`${base}/analyze`);
    expect(result.resource.extensions).toEqual({ bazaar: validBazaarDeclaration() });
    expect(result.payment.raw.paymentRequirements).toEqual(requirements);
    expect(hits).toEqual([{ path: '/analyze', method: 'GET' }]);
  });

  it('asks the seller with the declared method, HEAD included', async () => {
    // The seller here advertises GET, so its own declaration fails nothing; what matters is the probe's method
    const { result } = await resolve('/analyze', (info) => {
      info.input.method = 'HEAD';
    });
    expect(hits).toEqual([{ path: '/analyze', method: 'HEAD' }]);
    expect(result?.kind).toBe('resolved');
  });

  it('never sends a method other than GET or HEAD: the echo is refused before any request', async () => {
    const { echo, result } = await resolve('/analyze', (info) => {
      info.input.method = 'DELETE';
    });
    expect(echo).toEqual({ declared: true, valid: false, rejectedReason: REJECTED_UNSUPPORTED_METHOD });
    expect(result).toBeUndefined();
    expect(hits).toEqual([]);
  });

  it('makes no request to an origin not registered to the merchant', async () => {
    registered = false;
    const { result } = await resolve('/analyze');
    expect(result).toEqual({ kind: 'rejected', rejectedReason: REJECTED_ORIGIN_NOT_REGISTERED });
    expect(hits).toEqual([]);
  });

  it('does not follow a redirect: no verdict', async () => {
    const { result } = await resolve('/redirect');
    expect(result).toEqual({ kind: 'no_verdict' });
    expect(hits.map((hit) => hit.path)).toEqual(['/redirect']);
  });

  it('treats a 200 as no verdict, even carrying a PAYMENT-REQUIRED header', async () => {
    expect((await resolve('/ok')).result).toEqual({ kind: 'no_verdict' });
  });

  it('treats a seller that does not answer in time as no verdict', async () => {
    const started = Date.now();
    expect((await resolve('/slow')).result).toEqual({ kind: 'no_verdict' });
    // DISCOVERY_SELLER_TIMEOUT_MS is 300 here
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('rejects a 402 that declares no bazaar extension', async () => {
    expect((await resolve('/no-bazaar')).result).toEqual({ kind: 'rejected', rejectedReason: REJECTED_SELLER_NO_BAZAAR });
  });

  it("rejects when the settled requirements are not among the seller's accepts", async () => {
    expect((await resolve('/other-payto')).result).toEqual({ kind: 'rejected', rejectedReason: REJECTED_SELLER_NO_MATCHING_ACCEPTS });
  });

  it("matches without the amount and stores the seller's current price", async () => {
    const { result } = await resolve('/other-price');
    if (result?.kind !== 'resolved') throw new Error('expected resolved');
    expect((result.payment.raw.paymentRequirements as any).amount).toBe('999');
  });

  it('reads only the headers and never consumes the body', async () => {
    // A generous timeout, so a probe that read this endless body would sit on it for 3s
    // (and come back empty-handed when aborted); one that cancels it returns at once.
    const started = Date.now();
    const probe = await probeSeller(`${base}/stream`, 'GET', 3000);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(probe.ok).toBe(true);
    await vi.waitFor(() => expect(streamClosedEarly).toBe(true));
  });
});
