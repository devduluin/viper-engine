import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReadiness } from '../../../src/bootstrap/operations/readiness.js';
import { SchemaNotReadyError } from '../../../src/bootstrap/database.js';
import type { WorkerStatus } from '../../../src/application/worker/types.js';

function status(phase: WorkerStatus['phase'] = 'running'): WorkerStatus {
  return { phase, active: 0, maxActive: 0, settled: 0, yielded: 0, idlePolls: 0, failures: 0,
    maintenanceWoken: 0, maintenanceFailures: 0, observerFailures: 0, stopTimedOut: false };
}

test('readiness rechecks drain/worker state after DB validation and never probes a draining host', async () => {
  let draining = false; let checks = 0; let phase: WorkerStatus['phase'] = 'running';
  const probe = createReadiness(async () => { checks++; draining = true; }, () => status(phase), () => draining);
  assert.deepEqual(await probe(), { ready: false, code: 'draining' });
  await probe(); assert.equal(checks, 1);
  draining = false; phase = 'failed';
  assert.deepEqual(await probe(), { ready: false, code: 'worker_unavailable' });
  assert.equal(checks, 1);
});

test('timed-out readiness probes share one outstanding DB check rather than accumulating work', async () => {
  let release!: () => void; let checks = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const probe = createReadiness(() => { checks++; return gate; }, () => status(), () => false, 5);
  const results = await Promise.all([probe(), probe()]);
  assert.ok(results.every(result => result.code === 'database_unavailable'));
  await probe(); assert.equal(checks, 1);
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(await probe(), { ready: true, code: 'ready' });
  assert.equal(checks, 2);
});

test('readiness reports only safe codes for schema drift and private database errors', async () => {
  for (const failure of [new SchemaNotReadyError({ ready: false, current: 1, expected: 13, problem: 'pending' }),
    new Error('SECRET_CONNECTION_DETAILS')]) {
    const probe = createReadiness(async () => { throw failure; }, () => status(), () => false);
    const result = await probe();
    assert.equal(result.ready, false);
    assert.equal(result.code, failure instanceof SchemaNotReadyError ? 'schema_not_ready' : 'database_unavailable');
    assert.doesNotMatch(JSON.stringify(result), /SECRET/);
  }
});
