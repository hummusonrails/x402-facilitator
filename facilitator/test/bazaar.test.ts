import { afterAll, describe, expect, it } from 'vitest';
import { createLogger } from '../src/logging.js';
import { encodeExtensionResponses, evaluateBazaarDeclaration } from '../src/bazaar.js';
import { shutdownSchemaGuard } from '../src/schemaGuard.js';
import { LOOPBACK_RESOURCE_URL, normalizedPayment, validBazaarDeclaration } from './fixtures.js';

const logger = createLogger({ context: 'test' });

afterAll(async () => {
  await shutdownSchemaGuard();
});

describe('evaluateBazaarDeclaration', () => {
  it('reports declared: false when the payload carries no bazaar extension', async () => {
    expect(await evaluateBazaarDeclaration(normalizedPayment(undefined), logger)).toEqual({ declared: false });
  });

  it('accepts a declaration produced by declareDiscoveryExtension', async () => {
    const result = await evaluateBazaarDeclaration(normalizedPayment(validBazaarDeclaration()), logger);
    expect(result.declared).toBe(true);
    if (!result.declared || !result.valid) throw new Error('expected valid');
    expect(result.resource.resourceUrl).toBe('https://api.example.com/analyze');
    expect(result.resource.discoveryInfo.input.type).toBe('http');
    expect('method' in result.resource && result.resource.method).toBe('GET');
  });

  it('rejects an unknown input type without throwing', async () => {
    const result = await evaluateBazaarDeclaration(
      normalizedPayment({ info: { input: { type: 'grpc' } }, schema: { type: 'object' } }),
      logger
    );
    expect(result).toMatchObject({ declared: true, valid: false });
    expect((result as any).rejectedReason).toMatch(/input.type must be "http" or "mcp"/);
  });

  it('rejects a schema that references an external document', async () => {
    const declaration = validBazaarDeclaration();
    (declaration.schema as any).$ref = 'https://evil.example/schema.json';
    const result = await evaluateBazaarDeclaration(normalizedPayment(declaration), logger);
    expect(result).toMatchObject({ declared: true, valid: false });
    expect((result as any).rejectedReason).toMatch(/external \$ref/);
  });

  it('rejects info that does not satisfy its own schema', async () => {
    const declaration = validBazaarDeclaration();
    (declaration.info as any).input.method = 'POST'; // schema enum is GET/HEAD/DELETE
    const result = await evaluateBazaarDeclaration(normalizedPayment(declaration), logger);
    expect(result).toMatchObject({ declared: true, valid: false });
    expect((result as any).rejectedReason).toMatch(/schema validation/);
  });

  it('rejects an http declaration with no method', async () => {
    const declaration = validBazaarDeclaration();
    delete (declaration.info as any).input.method;
    const result = await evaluateBazaarDeclaration(normalizedPayment(declaration), logger);
    expect((result as any).rejectedReason).toMatch(/method is required/);
  });

  it('rejects a relative resource url', async () => {
    const result = await evaluateBazaarDeclaration(normalizedPayment(validBazaarDeclaration(), '/analyze'), logger);
    expect((result as any).rejectedReason).toMatch(/absolute http\(s\) URL/);
  });

  it('rejects a loopback resource url, so the catalog cannot point agents inward', async () => {
    const result = await evaluateBazaarDeclaration(normalizedPayment(validBazaarDeclaration(), LOOPBACK_RESOURCE_URL), logger);
    expect(result).toMatchObject({ declared: true, valid: false });
    expect((result as any).rejectedReason).toMatch(/loopback/);
  });

  it('rejects a link-local resource url', async () => {
    const result = await evaluateBazaarDeclaration(
      normalizedPayment(validBazaarDeclaration(), 'http://169.254.169.254/latest/meta-data/'),
      logger
    );
    expect((result as any).rejectedReason).toMatch(/IP literal/);
  });

  it('catalogues origin + routeTemplate when the declaration carries a route template', async () => {
    const declaration = { ...validBazaarDeclaration(), routeTemplate: '/users/:id' };
    const result = await evaluateBazaarDeclaration(normalizedPayment(declaration), logger);
    if (!result.declared || !result.valid) throw new Error('expected valid');
    expect(result.resource.resourceUrl).toBe('https://api.example.com/users/:id');
  });

  it('rejects a route template that makes the catalogued url over-long, though resource.url is short', async () => {
    // Under the declaration byte bound, so only the derived-URL screen can catch it
    const declaration = { ...validBazaarDeclaration(), routeTemplate: `/${'a'.repeat(3000)}` };
    const result = await evaluateBazaarDeclaration(normalizedPayment(declaration), logger);
    expect(result).toMatchObject({ declared: true, valid: false });
    expect((result as any).rejectedReason).toMatch(/routeTemplate.*at most \d+ characters/);
  });

  it('rejects an oversized declaration before any schema work', async () => {
    const declaration = validBazaarDeclaration();
    (declaration.info as any).padding = 'x'.repeat(20_000);
    const result = await evaluateBazaarDeclaration(normalizedPayment(declaration), logger);
    expect((result as any).rejectedReason).toMatch(/at most \d+ bytes/);
  });

  it('rejects non-object declarations', async () => {
    expect((await evaluateBazaarDeclaration(normalizedPayment('nope'), logger) as any).rejectedReason).toMatch(/must be an object/);
    expect((await evaluateBazaarDeclaration(normalizedPayment({ info: {} }), logger) as any).rejectedReason).toMatch(/schema is required/);
  });
});

describe('encodeExtensionResponses', () => {
  it('produces the spec example encoding', async () => {
    expect(encodeExtensionResponses({ bazaar: { status: 'success' } })).toBe('eyJiYXphYXIiOnsic3RhdHVzIjoic3VjY2VzcyJ9fQ==');
  });
});
