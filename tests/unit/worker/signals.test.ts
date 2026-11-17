import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { createWorkerHost } from '../../../src/application/worker/host.js';
import { runWorkerUntilSignal } from '../../../src/entrypoints/worker/signals.js';
import { workerFailureCode } from '../../../src/bootstrap/worker/failures.js';
import { EngineSetupError } from '../../../src/bootstrap/mcp-tools.js';
import { ApiFailure } from '../../../src/contracts/api/failure.js';

test('explicit signal entrypoint stops and removes handlers without changing global process listeners', async () => {
  const signals = new EventEmitter(); let closed = 0;
  const worker = createWorkerHost({ clock: { now: () => Date.now() }, classify: workerFailureCode, maintain: async () => 0,
    engine: { runOnce: async () => ({ kind: 'idle' }), close: async () => { closed += 1; } },
  }, { workerId: 'signals', pollMs: 5000 });
  const running = runWorkerUntilSignal(worker, signals);
  assert.equal(signals.listenerCount('SIGTERM'), 1); signals.emit('SIGTERM'); signals.emit('SIGINT'); await running;
  assert.equal(closed, 1); assert.equal(signals.listenerCount('SIGTERM'), 0); assert.equal(signals.listenerCount('SIGINT'), 0);
});

test('worker classifies only known safe failures; arbitrary SDK text/code cannot become a public event', () => {
  assert.equal(workerFailureCode(new EngineSetupError('authentication_required')), 'authentication_required');
  assert.equal(workerFailureCode(new EngineSetupError('invalid_catalog')), 'invalid_configuration');
  assert.equal(workerFailureCode(new EngineSetupError('connection_unavailable')), 'connection_unavailable');
  assert.equal(workerFailureCode(new ApiFailure('AUTHENTICATION_REQUIRED')), 'authentication_required');
  assert.equal(workerFailureCode({ code: 'PRIVATE_SECRET', message: 'PRIVATE' }), 'execution_failure');
});
