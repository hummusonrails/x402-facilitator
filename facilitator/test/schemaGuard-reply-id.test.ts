import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The worker reply carries the id of the job it answers, and the parent must compare it.
 *
 * A worker can post a result in the instant before the timeout's `terminate()` lands, and
 * that message can be delivered after the next job is already in flight on a fresh worker.
 * Resolving whatever happens to be in flight would then hand the new job the dead job's
 * verdict — a rejected declaration reported as valid, or the reverse.
 *
 * Replies here are injected directly, because the race is a matter of microseconds against
 * a real worker and cannot be scheduled reliably.
 */

// Long enough that no test below races its own timeout, short enough to fire on demand
process.env.DISCOVERY_SCHEMA_TIMEOUT_MS = '150';

/** Stand-in for a worker thread: records what it was sent, replies only when told to. */
class FakeWorker extends EventEmitter {
  static instances: FakeWorker[] = [];
  readonly posted: { id: number; declaration: unknown }[] = [];
  terminated = false;

  constructor() {
    super();
    FakeWorker.instances.push(this);
    // The real worker signals readiness once it has loaded the SDK
    setImmediate(() => this.emit('message', { ready: true }));
  }

  unref(): void {}

  postMessage(message: { id: number; declaration: unknown }): void {
    this.posted.push(message);
  }

  async terminate(): Promise<number> {
    this.terminated = true;
    return 0;
  }

  /** Deliver a reply as the real worker's message event would. */
  reply(id: number, result: unknown): void {
    this.emit('message', { id, result });
  }
}

vi.mock('node:worker_threads', () => ({ Worker: FakeWorker }));

const { validateDeclarationSchema, shutdownSchemaGuard } = await import('../src/schemaGuard.js');

/** Let queued microtasks and immediates run without outliving the validation timeout. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

/** Resolve once the worker has actually been handed a job. */
async function dispatched(worker: FakeWorker, count: number): Promise<void> {
  for (let i = 0; i < 50 && worker.posted.length < count; i++) await settle();
  expect(worker.posted.length).toBeGreaterThanOrEqual(count);
}

afterEach(async () => {
  await shutdownSchemaGuard();
  FakeWorker.instances = [];
});

describe('schema guard reply ids', () => {
  it('ignores a reply whose id does not match the job in flight', async () => {
    let settled: unknown = null;
    const pending = validateDeclarationSchema({ info: {}, schema: {} }).then((r) => (settled = r));

    const worker = FakeWorker.instances[0];
    await dispatched(worker, 1);
    const jobId = worker.posted[0].id;

    // A reply for some earlier job, arriving on the worker now serving this one
    worker.reply(jobId - 1, { valid: true });
    await settle();
    expect(settled).toBeNull();

    // The job's own reply still resolves it
    worker.reply(jobId, { valid: false, errors: ['genuine violation'] });
    await pending;
    expect(settled).toEqual({ valid: false, errors: ['genuine violation'] });
  });

  it('does not let a killed job’s late reply resolve the next job', async () => {
    // First job never answers, so the timeout fires and terminates its worker
    const first = await validateDeclarationSchema({ info: {}, schema: {} });
    expect(first).toMatchObject({ valid: false, timedOut: true });
    const firstWorker = FakeWorker.instances[0];
    expect(firstWorker.terminated).toBe(true);
    const staleId = firstWorker.posted[0].id;

    let settled: unknown = null;
    const second = validateDeclarationSchema({ info: {}, schema: {} }).then((r) => (settled = r));

    const secondWorker = FakeWorker.instances[1];
    expect(secondWorker).not.toBe(firstWorker);
    await dispatched(secondWorker, 1);
    expect(secondWorker.posted[0].id).not.toBe(staleId);

    // The dead job's result, delivered late. Before the id check this resolved the new job.
    secondWorker.reply(staleId, { valid: true });
    await settle();
    expect(settled).toBeNull();

    secondWorker.reply(secondWorker.posted[0].id, { valid: false, errors: ['genuine violation'] });
    await second;
    expect(settled).toEqual({ valid: false, errors: ['genuine violation'] });
  });
});
