import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { DISCOVERY_SCHEMA_TIMEOUT_MS } from './config.js';
import { createLogger } from './logging.js';

const logger = createLogger({ context: 'schemaGuard' });

/**
 * Guarded JSON Schema validation for bazaar declarations.
 *
 * `validateDiscoveryExtension` compiles the declaration's own `schema` with Ajv and runs
 * it against the declaration's own `info`. Both halves come from the paying client, and
 * Ajv turns a schema `pattern` straight into a `RegExp` with no linear-time guarantee and
 * no timeout, so a schema like `{"pattern": "^(a+)+$"}` matched against `"aaaa...b"` costs
 * exponential time in the length of the data. On the main thread that blocks the event
 * loop for the whole process: one request, one outage.
 *
 * So the Ajv step runs in a worker thread we can actually kill. A validation that outruns
 * DISCOVERY_SCHEMA_TIMEOUT_MS gets its worker terminated and reports `timedOut`; the
 * caller treats that as a rejected declaration. Catastrophic backtracking and an
 * expensive compile are both covered, without having to guess which regexes are unsafe.
 *
 * One worker per trust boundary ("lane"), because a worker busy backtracking cannot serve
 * anything else anyway. `/verify` is unauthenticated and does not consume the nonce, so one
 * validly signed payload can be replayed against it to keep its worker busy; giving it a
 * lane of its own means that traffic can only ever saturate `/verify`'s own verdicts. The
 * `settle` lane is reached only after an authenticated, rate-limited settle whose payment
 * confirmed. Jobs queue per lane; past that lane's depth they report `unavailable`, which
 * the caller reports as `processing` rather than as a verdict on the declaration.
 */

export type SchemaGuardResult =
  | { valid: true }
  | { valid: false; errors: string[] }
  /** Validation exceeded the timeout and the worker was killed */
  | { valid: false; timedOut: true; errors: string[] }
  /** The validator was saturated; no verdict was reached */
  | { valid: false; unavailable: true; errors: string[] };

/** `verify`: unauthenticated /verify traffic. `settle`: confirmed, authenticated settlements. */
export type SchemaLane = 'verify' | 'settle';

/**
 * Queue depth per lane. Each settle queues two jobs (the buyer's echo, then the seller's own
 * declaration), so the settle lane is twice as deep to keep the capacity a single shared
 * queue used to give it; its traffic is authenticated, rate-limited and paid for.
 */
export const MAX_QUEUE_DEPTH: Readonly<Record<SchemaLane, number>> = { verify: 32, settle: 64 };

const sdkPath = createRequire(import.meta.url).resolve('@x402/extensions/bazaar');

/**
 * Worker body, kept inline so it needs no build step of its own and resolves identically
 * under `tsx src/server.ts`, `node dist/server.js` and vitest. `eval: true` runs it as
 * CommonJS, and the SDK path is resolved by the parent so the worker does no lookup.
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const { validateDiscoveryExtension } = require(workerData.sdkPath);
parentPort.postMessage({ ready: true });
parentPort.on('message', (message) => {
  let result;
  try {
    result = validateDiscoveryExtension(message.declaration);
  } catch (error) {
    result = { valid: false, errors: ['schema validation threw: ' + ((error && error.message) || String(error))] };
  }
  parentPort.postMessage({ id: message.id, result });
});
`;

interface Job {
  declaration: unknown;
  resolve: (result: SchemaGuardResult) => void;
}

/** Generous bound on worker startup, which is not the validation budget. */
const WORKER_STARTUP_TIMEOUT_MS = 10_000;

interface SchemaGuard {
  validate(declaration: unknown): Promise<SchemaGuardResult>;
  shutdown(): Promise<void>;
}

/** One lane: its own worker thread, queue and in-flight job. */
function createSchemaGuard(lane: SchemaLane): SchemaGuard {
  const maxQueueDepth = MAX_QUEUE_DEPTH[lane];
  let worker: Worker | null = null;
  /** Resolves once the current worker has loaded the SDK and can accept a job. */
  let workerReady: Promise<void> | null = null;
  let inFlight: { id: number; job: Job; timer: NodeJS.Timeout } | null = null;
  const queue: Job[] = [];
  let nextId = 1;
  let pumping = false;

  function disposeWorker(): void {
    const dying = worker;
    worker = null;
    workerReady = null;
    if (dying) void dying.terminate();
  }

  /** Fail the in-flight job (if any) and drop the worker, so the next job starts clean. */
  function abandonInFlight(result: SchemaGuardResult): void {
    const current = inFlight;
    inFlight = null;
    disposeWorker();
    if (current) {
      clearTimeout(current.timer);
      current.job.resolve(result);
    }
  }

  function spawnWorker(): Worker {
    const created = new Worker(WORKER_SOURCE, { eval: true, workerData: { sdkPath } });
    // Never hold the process open; this thread is a helper, not a reason to keep running
    created.unref();

    // Spawning the thread and loading the SDK costs ~100ms. That is startup, not validation,
    // so it must not be charged against DISCOVERY_SCHEMA_TIMEOUT_MS: doing so falsely
    // rejects the first honest declaration after boot, and any declaration that arrives
    // while the box is busy.
    workerReady = new Promise<void>((resolve, reject) => {
      const startupTimer = setTimeout(
        () => reject(new Error('schema validation worker did not start')),
        WORKER_STARTUP_TIMEOUT_MS
      );
      startupTimer.unref?.();
      created.once('message', () => {
        clearTimeout(startupTimer);
        resolve();
      });
      created.once('error', (error) => {
        clearTimeout(startupTimer);
        reject(error);
      });
    });

    created.on('message', (message: { ready?: boolean; id?: number; result?: SchemaGuardResult }) => {
      if (message.ready) return;
      const current = inFlight;
      if (!current) return;
      // A worker can post a result just as the timeout terminates it, and that message can
      // land after the next job is already in flight on a fresh worker. Without this the new
      // job would be resolved with the dead job's verdict.
      if (message.id !== current.id) {
        logger.warn('Discarding stale schema validation reply', { lane, replyId: message.id, expectedId: current.id });
        return;
      }
      inFlight = null;
      clearTimeout(current.timer);
      current.job.resolve(message.result ?? { valid: false, errors: ['schema validation returned nothing'] });
      void pump();
    });

    created.on('error', (error) => {
      // An error from a worker we already replaced must not fail the job on its successor
      if (worker !== created) return;
      logger.error('Schema validation worker errored', { lane, error: error.message });
      abandonInFlight({ valid: false, unavailable: true, errors: ['schema validator unavailable'] });
      void pump();
    });

    created.on('exit', (code) => {
      // A terminate() we asked for has already cleared `worker`; anything else is a crash
      if (worker !== created) return;
      logger.error('Schema validation worker exited', { lane, code });
      abandonInFlight({ valid: false, unavailable: true, errors: ['schema validator unavailable'] });
      void pump();
    });

    return created;
  }

  /**
   * Start the next queued job once the worker is up. `pumping` guards against two callers
   * racing through the await while the queue still looks free.
   */
  async function pump(): Promise<void> {
    if (pumping || inFlight || queue.length === 0) return;
    pumping = true;
    try {
      if (!worker) worker = spawnWorker();
      const active = worker;
      const ready = workerReady;

      try {
        await ready;
      } catch (error: any) {
        logger.error('Schema validation worker failed to start', { lane, error: error.message });
        if (worker === active) disposeWorker();
        const job = queue.shift();
        job?.resolve({ valid: false, unavailable: true, errors: ['schema validator unavailable'] });
        return;
      }

      // The worker may have been torn down while we waited
      if (worker !== active) return;
      if (inFlight || queue.length === 0) return;
      const job = queue.shift()!;

      const timer = setTimeout(() => {
        logger.warn('Schema validation timed out; terminating worker', { lane, timeoutMs: DISCOVERY_SCHEMA_TIMEOUT_MS });
        abandonInFlight({
          valid: false,
          timedOut: true,
          errors: [`schema validation exceeded ${DISCOVERY_SCHEMA_TIMEOUT_MS}ms`],
        });
        void pump();
      }, DISCOVERY_SCHEMA_TIMEOUT_MS);
      // The timer must not hold the process open either
      timer.unref?.();

      // The id travels with the job and comes back on the reply, so a reply that outlived
      // its job can be told apart from the answer to the job now in flight
      const id = nextId++;
      inFlight = { id, job, timer };
      active.postMessage({ id, declaration: job.declaration });
    } finally {
      pumping = false;
      // A job may have queued while we were awaiting readiness
      if (!inFlight && queue.length > 0) setImmediate(() => void pump());
    }
  }

  return {
    validate(declaration: unknown): Promise<SchemaGuardResult> {
      if (queue.length >= maxQueueDepth) {
        logger.warn('Schema validation queue full; declining without a verdict', { lane, depth: queue.length });
        return Promise.resolve({ valid: false, unavailable: true, errors: ['schema validator busy'] });
      }
      return new Promise<SchemaGuardResult>((resolve) => {
        queue.push({ declaration, resolve });
        void pump();
      });
    },

    async shutdown(): Promise<void> {
      const dying = worker;
      worker = null;
      workerReady = null;
      if (inFlight) {
        clearTimeout(inFlight.timer);
        inFlight.job.resolve({ valid: false, unavailable: true, errors: ['schema validator shutting down'] });
        inFlight = null;
      }
      while (queue.length > 0) {
        queue.shift()!.resolve({ valid: false, unavailable: true, errors: ['schema validator shutting down'] });
      }
      if (dying) await dying.terminate();
    },
  };
}

/** Created on first use, so with discovery off no worker ever starts. */
const guards: Partial<Record<SchemaLane, SchemaGuard>> = {};

/**
 * Validate `info` against the declaration's own `schema`, off the main thread and under a
 * hard timeout, on the given lane's worker. Never throws. The lane is required so that no
 * caller can land on the other trust boundary's queue by default.
 */
export function validateDeclarationSchema(declaration: unknown, lane: SchemaLane): Promise<SchemaGuardResult> {
  const guard = (guards[lane] ??= createSchemaGuard(lane));
  return guard.validate(declaration);
}

/**
 * Release both lanes' workers. For tests and graceful shutdown. The instances are dropped as
 * well as their workers terminated, so the next call on either lane builds a fresh guard and
 * spawns a fresh worker rather than queueing onto a dead one.
 */
export async function shutdownSchemaGuard(): Promise<void> {
  const current = Object.values(guards);
  for (const lane of Object.keys(guards) as SchemaLane[]) delete guards[lane];
  await Promise.all(current.map((guard) => guard?.shutdown()));
}
