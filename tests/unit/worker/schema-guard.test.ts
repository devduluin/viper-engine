import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorkerHost } from '../../../src/application/worker/host.js';
import { guardWorkerSchema } from '../../../src/bootstrap/worker/schema-guard.js';

function fixture(check: () => Promise<unknown>) {
  let claims = 0; let maintenance = 0; let closed = 0;
  const host = createWorkerHost({ clock: { now: () => Date.now() }, classify: () => 'execution_failure',
    maintain: async () => { maintenance++; return 0; },
    engine: { runOnce: async () => { claims++; return { kind: 'idle' }; }, close: async () => { closed++; } },
  }, { workerId: 'schema-test', concurrency: 1, pollMs: 5000 });
  return { guarded: guardWorkerSchema(host, check), counts: () => ({ claims, maintenance, closed }) };
}

test('schema guard admits no claims or maintenance until validation completes', async () => {
  let release!: () => void; let checks = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const { guarded, counts } = fixture(async () => { checks++; await gate; });
  try {
    guarded.start(); guarded.start();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(counts(), { claims: 0, maintenance: 0, closed: 0 });
    assert.equal(checks, 1);
    release(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(counts().claims, 1); assert.equal(counts().maintenance, 1);
  } finally { release(); await guarded.stop(); }
  assert.equal(counts().closed, 1);
});

test('stop during a pending schema check drains immediately and never starts loops afterwards', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const { guarded, counts } = fixture(() => gate);
  guarded.start(); await guarded.stop(); await guarded.done;
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(counts(), { claims: 0, maintenance: 0, closed: 1 });
  assert.equal(guarded.status().phase, 'stopped');
  assert.throws(() => guarded.start(), /cannot restart/);
});

test('schema failure is observable through done and stop without admitting work', async () => {
  const failure = new Error('schema check failed');
  const { guarded, counts } = fixture(async () => { throw failure; });
  guarded.start();
  await assert.rejects(guarded.done, error => error === failure);
  await assert.rejects(guarded.stop(), error => error === failure);
  assert.equal(guarded.status().phase, 'failed');
  assert.deepEqual(counts(), { claims: 0, maintenance: 0, closed: 1 });
});
