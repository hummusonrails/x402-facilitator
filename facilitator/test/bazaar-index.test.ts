import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscoveredResource } from '@x402/extensions/bazaar';
import { createLogger } from '../src/logging.js';
import { MERCHANT, RESOURCE_URL, normalizedPayment, validBazaarDeclaration } from './fixtures.js';

// The store is replaced: these cases are about which origin indexBazaarResource checks and
// writes, not about SQL (test/discoveryStore.test.ts covers the locked check-and-write
// against real Postgres). `registered` stands in for discovery_merchant_origins.
let registered: (origin: string) => boolean = () => false;
const indexIfOriginRegistered = vi.fn(async (args: { origin: string }) =>
  registered(args.origin) ? 'inserted' : 'origin_not_registered'
);
vi.mock('../src/discoveryStore.js', () => ({
  indexIfOriginRegistered: (...args: [{ origin: string }]) => indexIfOriginRegistered(...args),
}));

const { indexBazaarResource } = await import('../src/bazaar.js');
const logger = createLogger({ context: 'test' });

/** An accepted declaration as evaluateBazaarDeclaration hands it on, with the canonical URL given */
function resource(resourceUrl: string): DiscoveredResource {
  return {
    resourceUrl,
    x402Version: 2,
    method: 'GET',
    discoveryInfo: { input: { type: 'http', method: 'GET' }, output: { type: 'json' } },
  } as unknown as DiscoveredResource;
}

beforeEach(() => {
  registered = () => false;
  indexIfOriginRegistered.mockClear();
});

describe('indexBazaarResource origin check', () => {
  it('indexes on a registered origin, writing the same normalized origin it checked', async () => {
    registered = () => true;

    const outcome = await indexBazaarResource(
      resource('https://API.Example.com:443/analyze'),
      normalizedPayment(validBazaarDeclaration()),
      MERCHANT,
      logger
    );

    expect(outcome).toBe('inserted');
    expect(indexIfOriginRegistered).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'https://api.example.com', merchantAddress: MERCHANT })
    );
  });

  it('refuses an origin not registered to the settling merchant and writes nothing', async () => {

    const outcome = await indexBazaarResource(
      resource('https://someone-else.example.com/made-up'),
      normalizedPayment(validBazaarDeclaration()),
      MERCHANT,
      logger
    );

    expect(outcome).toBe('origin_not_registered');
  });

  it('checks the canonical URL that is stored, not the payload resource.url', async () => {
    // The buyer's resource.url is on the registered origin; the catalogued URL is not
    registered = (origin) => origin === new URL(RESOURCE_URL).origin;

    const outcome = await indexBazaarResource(
      resource('https://someone-else.example.com/analyze'),
      normalizedPayment(validBazaarDeclaration(), RESOURCE_URL),
      MERCHANT,
      logger
    );

    expect(indexIfOriginRegistered).toHaveBeenCalledWith(expect.objectContaining({ origin: 'https://someone-else.example.com' }));
    expect(outcome).toBe('origin_not_registered');
  });

  it('fails closed on a canonical URL that does not parse, without throwing', async () => {
    const outcome = await indexBazaarResource(
      resource('not a url'),
      normalizedPayment(validBazaarDeclaration()),
      MERCHANT,
      logger
    );

    expect(outcome).toBe('origin_not_registered');
    expect(indexIfOriginRegistered).not.toHaveBeenCalled();
  });
});
