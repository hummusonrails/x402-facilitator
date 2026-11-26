import { afterAll, describe, expect, it } from 'vitest';
import { createLogger } from '../src/logging.js';
import { evaluateBazaarDeclaration } from '../src/bazaar.js';
import { MAX_QUEUE_DEPTH, shutdownSchemaGuard, validateDeclarationSchema, type SchemaLane } from '../src/schemaGuard.js';
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
    const result = await validateDeclarationSchema(
      {
        info: { input: { type: 'http', method: 'GET' } },
        schema: { type: 'object' },
      },
      'verify'
    );
    expect(result.valid).toBe(true);
  });

  it('reports a genuine schema violation as invalid, not as a timeout', async () => {
    const result = await validateDeclarationSchema(
      {
        info: { input: { type: 'http', method: 'GET' }, count: 'not-a-number' },
        schema: { type: 'object', properties: { count: { type: 'number' } } },
      },
      'verify'
    );
    expect(result.valid).toBe(false);
    expect(result).not.toHaveProperty('timedOut');
  });

  it('kills a catastrophically backtracking pattern instead of hanging', async () => {
    const started = Date.now();
    const result = await validateDeclarationSchema(redosDeclaration(64), 'verify');
    const elapsed = Date.now() - started;

    expect(result).toMatchObject({ valid: false, timedOut: true });
    // Without the guard this call does not return in any bounded time
    expect(elapsed).toBeLessThan(5000);
  });

  it('leaves the event loop responsive while a pattern is backtracking', async () => {
    let ticks = 0;
    const interval = setInterval(() => { ticks++; }, 10);

    try {
      const result = await validateDeclarationSchema(redosDeclaration(64), 'verify');
      expect(result).toMatchObject({ valid: false, timedOut: true });
    } finally {
      clearInterval(interval);
    }

    // The timers only fire if the main thread was never blocked by the match
    expect(ticks).toBeGreaterThan(3);
  });

  it('recovers and serves the next declaration after a timeout killed the worker', async () => {
    await validateDeclarationSchema(redosDeclaration(64), 'verify');
    const result = await validateDeclarationSchema(
      {
        info: { input: { type: 'http', method: 'GET' } },
        schema: { type: 'object' },
      },
      'verify'
    );
    expect(result.valid).toBe(true);
  });
});

describe('evaluateBazaarDeclaration under a hostile schema', () => {
  it('reaches no verdict without stalling the request, and never indexes', async () => {
    const started = Date.now();
    const result = await evaluateBazaarDeclaration(normalizedPayment(redosDeclaration(64)), logger, 'settle');

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
    const result = await validateDeclarationSchema(
      {
        info: { input: { type: 'http', method: 'GET' } },
        schema: { type: 'object' },
      },
      'verify'
    );
    expect(result.valid).toBe(true);
  });
});

const CHEAP = { info: { input: { type: 'http', method: 'GET' } }, schema: { type: 'object' } };

/** Occupy `lane`'s worker with a backtracking match and return the pending result. */
async function occupy(lane: SchemaLane) {
  // Warm the lane first, so the hostile job is in flight (not queued) once this returns
  expect((await validateDeclarationSchema(CHEAP, lane)).valid).toBe(true);
  const hostile = validateDeclarationSchema(redosDeclaration(64), lane);
  await new Promise((resolve) => setTimeout(resolve, 20));
  // Wrapped, so an `await` on this helper does not wait for the hostile job itself
  return { hostile };
}

describe('separate lanes for /verify and /settle', () => {
  it('a saturated verify lane leaves the settle lane serving real verdicts', async () => {
    let hostileDone = false;
    const hostile = (await occupy('verify')).hostile.then((result) => {
      hostileDone = true;
      return result;
    });
    // Fill the verify queue behind the backtracking job
    const queued = Array.from({ length: MAX_QUEUE_DEPTH.verify }, () => validateDeclarationSchema(CHEAP, 'verify'));
    expect(await validateDeclarationSchema(CHEAP, 'verify')).toMatchObject({ valid: false, unavailable: true });

    // Meanwhile the settle lane answers, on a worker of its own: verify's is still backtracking
    const started = Date.now();
    expect(await validateDeclarationSchema(CHEAP, 'settle')).toEqual({ valid: true });
    expect(hostileDone).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);

    expect(await hostile).toMatchObject({ valid: false, timedOut: true });
    for (const result of await Promise.all(queued)) expect(result.valid).toBe(true);
  });

  it.each([
    ['verify', 32],
    ['settle', 64],
  ] as const)('the %s lane queues %i jobs behind a busy worker before declining', async (lane, depth) => {
    expect(MAX_QUEUE_DEPTH[lane]).toBe(depth);
    const { hostile } = await occupy(lane);
    const queued = Array.from({ length: depth }, () => validateDeclarationSchema(CHEAP, lane));
    expect(await validateDeclarationSchema(CHEAP, lane)).toMatchObject({ valid: false, unavailable: true });
    await hostile;
    for (const result of await Promise.all(queued)) expect(result.valid).toBe(true);
  });

  it('shutdown drops both lanes, and each respawns on its next call', async () => {
    expect((await validateDeclarationSchema(CHEAP, 'verify')).valid).toBe(true);
    expect((await validateDeclarationSchema(CHEAP, 'settle')).valid).toBe(true);

    await shutdownSchemaGuard();

    // A guard left holding a dead worker would hang or time out here, not answer
    const bounded = (lane: SchemaLane) =>
      Promise.race([
        validateDeclarationSchema(CHEAP, lane),
        new Promise((resolve) => setTimeout(() => resolve('hung'), 4000)),
      ]);
    expect(await bounded('verify')).toEqual({ valid: true });
    expect(await bounded('settle')).toEqual({ valid: true });
  });
});
