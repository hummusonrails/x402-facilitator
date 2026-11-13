import { afterAll, describe, expect, it } from 'vitest';
import { createLogger } from '../src/logging.js';
import { evaluateBazaarDeclaration } from '../src/bazaar.js';
import { shutdownSchemaGuard, validateDeclarationSchema } from '../src/schemaGuard.js';
import { normalizedPayment } from './fixtures.js';

const logger = createLogger({ context: 'test' });

afterAll(async () => {
  await shutdownSchemaGuard();
});

/**
 * A schema whose `pattern` backtracks catastrophically against the `info` it is validated
 * against. Both halves reach us from the paying client. Run on the main thread this
 * blocks the event loop for the life of the match; 32 characters already exceeds two
 * minutes, and the payload can be far longer than that.
 */
function redosDeclaration(length: number): Record<string, unknown> {
  return {
    info: { input: { type: 'http', method: 'GET' }, junk: 'a'.repeat(length) + 'b' },
    schema: { type: 'object', properties: { junk: { type: 'string', pattern: '^(a+)+$' } } },
  };
}

describe('validateDeclarationSchema', () => {
  it('validates a well-formed declaration', async () => {
    const result = await validateDeclarationSchema({
      info: { input: { type: 'http', method: 'GET' } },
      schema: { type: 'object' },
    });
    expect(result.valid).toBe(true);
  });

  it('reports a genuine schema violation as invalid, not as a timeout', async () => {
    const result = await validateDeclarationSchema({
      info: { input: { type: 'http', method: 'GET' }, count: 'not-a-number' },
      schema: { type: 'object', properties: { count: { type: 'number' } } },
    });
    expect(result.valid).toBe(false);
    expect(result).not.toHaveProperty('timedOut');
  });

  it('kills a catastrophically backtracking pattern instead of hanging', async () => {
    const started = Date.now();
    const result = await validateDeclarationSchema(redosDeclaration(64));
    const elapsed = Date.now() - started;

    expect(result).toMatchObject({ valid: false, timedOut: true });
    // Without the guard this call does not return in any bounded time
    expect(elapsed).toBeLessThan(5000);
  });

  it('leaves the event loop responsive while a pattern is backtracking', async () => {
    let ticks = 0;
    const interval = setInterval(() => { ticks++; }, 10);

    try {
      const result = await validateDeclarationSchema(redosDeclaration(64));
      expect(result).toMatchObject({ valid: false, timedOut: true });
    } finally {
      clearInterval(interval);
    }

    // The timers only fire if the main thread was never blocked by the match
    expect(ticks).toBeGreaterThan(3);
  });

  it('recovers and serves the next declaration after a timeout killed the worker', async () => {
    await validateDeclarationSchema(redosDeclaration(64));
    const result = await validateDeclarationSchema({
      info: { input: { type: 'http', method: 'GET' } },
      schema: { type: 'object' },
    });
    expect(result.valid).toBe(true);
  });
});

describe('evaluateBazaarDeclaration under a hostile schema', () => {
  it('reaches no verdict without stalling the request, and never indexes', async () => {
    const started = Date.now();
    const result = await evaluateBazaarDeclaration(normalizedPayment(redosDeclaration(64)), logger);

    expect(Date.now() - started).toBeLessThan(5000);
    // Deferred, not rejected: a timeout cannot tell a hostile regex from a starved CPU
    expect(result).toMatchObject({ declared: true, valid: false, deferred: true });
    // Either way nothing is catalogued, which is what actually matters
    expect(result).not.toHaveProperty('resource');
  });

  it('does not charge worker startup against the validation budget', async () => {
    await shutdownSchemaGuard();

    // First call after a cold start: spawning the thread and loading the SDK costs ~100ms,
    // which must not be mistaken for a slow schema
    const result = await validateDeclarationSchema({
      info: { input: { type: 'http', method: 'GET' } },
      schema: { type: 'object' },
    });
    expect(result.valid).toBe(true);
  });
});
