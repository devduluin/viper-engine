import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorkerHost } from '../../../src/application/worker/host.js';
import { withDeadline } from '../../../src/shared/async/deadline.js';
import { delay } from '../../../src/shared/async/delay.js';
import { workerFailureCode } from '../../../src/bootstrap/worker/failures.js';

const clock = { now: () => Date.now() };
const options = { workerId: 'host-test', pollMs: 10, maintenanceMs: 20, shutdownTimeoutMs: 1000 };

test('worker claims no more than concurrency and shutdown aborts/awaits all slots exactly once', async () => {
  let calls = 0; let active = 0; let maximum = 0; let closed = 0;
  let ready: (() => void) | undefined; const started = new Promise<void>(resolve => { ready = resolve; });
  const worker = createWorkerHost({ clock, classify: workerFailureCode, maintain: async () => 0, engine: {
    runOnce: async (_id, signal) => {
      calls += 1; active += 1; maximum = Math.max(maximum, active);
      if (active === 3) ready?.();
      await new Promise<void>(resolve => signal?.addEventListener('abort', () => resolve(), { once: true }));
      active -= 1; return { kind: 'yielded', runId: 'run' };
    }, close: async () => { closed += 1; },
  } }, { ...options, concurrency: 3 });
  assert.equal(calls, 0); worker.start(); worker.start();
  await withDeadline(() => started, { operationName: 'all slots started', timeoutMs: 2000 });
  await Promise.all([worker.stop(), worker.stop()]); await worker.done;
  assert.equal(maximum, 3); assert.equal(active, 0); assert.equal(calls, 3); assert.equal(closed, 1);
  assert.equal(worker.status().phase, 'stopped'); assert.equal(worker.status().yielded, 3);
  assert.throws(() => worker.start(), /cannot restart/);
});

test('per-slot failures back off exponentially without echoing private errors or creating an idle hot loop', async () => {
  const times: number[] = []; const events: unknown[] = []; let ready: (() => void) | undefined;
  const failed = new Promise<void>(resolve => { ready = resolve; });
  const worker = createWorkerHost({ clock, classify: workerFailureCode, maintain: async () => 0,
    engine: { runOnce: async () => { times.push(Date.now()); throw new Error('PRIVATE_SQL_PASSWORD'); }, close: async () => undefined },
    onEvent: event => { events.push(event); if (times.length === 3) ready?.(); },
  }, { ...options, concurrency: 1, errorBackoffMs: 30, maxErrorBackoffMs: 120 });
  worker.start();
  try {
    await withDeadline(() => failed, { operationName: 'backoff attempts', timeoutMs: 3000 });
    assert.ok(times[1]! - times[0]! >= 25); assert.ok(times[2]! - times[1]! >= 50);
    assert.equal(worker.status().failures, 3);
    assert.ok(!JSON.stringify(events).includes('PRIVATE_SQL_PASSWORD'));
  } finally { await worker.stop(); }
});

test('shutdown timeout does not claim drain completed; done settles after outstanding I/O actually returns', async () => {
  let release: (() => void) | undefined; const blocked = new Promise<void>(resolve => { release = resolve; });
  const worker = createWorkerHost({ clock, classify: workerFailureCode, maintain: async () => 0,
    engine: { runOnce: async () => { await blocked; return { kind: 'yielded', runId: 'blocked' }; }, close: async () => undefined },
  }, { ...options, concurrency: 1, shutdownTimeoutMs: 20 });
  worker.start();
  await assert.rejects(worker.stop(), /worker shutdown/);
  assert.equal(worker.status().phase, 'stopping'); assert.equal(worker.status().stopTimedOut, true);
  assert.equal(worker.status().active, 1); release?.(); await worker.done;
  assert.equal(worker.status().phase, 'stopped'); assert.equal(worker.status().active, 0);
});

test('throwing/hanging observers are bounded and cannot repeat settled work', async () => {
  let calls = 0; let idle: (() => void) | undefined; const reachedIdle = new Promise<void>(resolve => { idle = resolve; });
  const worker = createWorkerHost({ clock, classify: workerFailureCode, maintain: async () => 0,
    engine: { runOnce: async () => {
      calls += 1; if (calls === 1) return { kind: 'settled', runId: 'r', status: 'completed', reason: 'final_answer' };
      idle?.(); return { kind: 'idle' };
    }, close: async () => undefined }, onEvent: async () => new Promise(() => undefined),
  }, { ...options, concurrency: 1, observerTimeoutMs: 10 });
  worker.start();
  try {
    await withDeadline(() => reachedIdle, { operationName: 'observer timeout', timeoutMs: 2000 });
    assert.equal(worker.status().settled, 1); assert.equal(worker.status().observerFailures, 1);
  } finally { await worker.stop(); }
});

test('maintenance failure is isolated and idle polling sleeps instead of spinning', async () => {
  let calls = 0;
  const worker = createWorkerHost({ clock, classify: workerFailureCode,
    engine: { runOnce: async () => { calls += 1; return { kind: 'idle' }; }, close: async () => undefined },
    maintain: async () => { throw new Error('PRIVATE_MAINTENANCE'); },
  }, { ...options, concurrency: 1, pollMs: 30, errorBackoffMs: 50 });
  worker.start(); await delay(100); await worker.stop();
  assert.ok(calls >= 1 && calls < 15); assert.ok(worker.status().maintenanceFailures >= 1);
  assert.equal(worker.status().failures, 0);
});

test('stop before start closes resources and configuration errors fail before work', async () => {
  let closed = 0;
  const deps = { clock, classify: workerFailureCode, maintain: async () => 0,
    engine: { runOnce: async () => ({ kind: 'idle' as const }), close: async () => { closed += 1; } } };
  const worker = createWorkerHost(deps, options); await worker.stop(); assert.equal(closed, 1);
  for (const override of [{ concurrency: 0 }, { concurrency: 33 }, { pollMs: 0 }, { workerId: 'not valid' },
    { maxErrorBackoffMs: 1 }, { maintenanceBatch: 1001 }]) assert.throws(() => createWorkerHost(deps, { ...options, ...override }));
});

test('resource-close faults reject stop/done safely without unhandled background errors', async () => {
  const worker = createWorkerHost({ clock, classify: workerFailureCode, maintain: async () => 0,
    engine: { runOnce: async () => ({ kind: 'idle' }), close: () => { throw new Error('PRIVATE_CLOSE_ERROR'); } },
  }, options);
  await assert.rejects(worker.stop(), /^Error: Worker shutdown failed$/);
  await assert.rejects(worker.done, /^Error: Worker shutdown failed$/); assert.equal(worker.status().phase, 'failed');
});
