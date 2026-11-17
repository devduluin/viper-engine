import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StreamSessions } from '../../../src/entrypoints/http/sse/sessions.js';
import { testScope } from '../../support/agent/setup.js';
import { ApiFailure } from '../../../src/contracts/api/failure.js';
import { delay } from '../../../src/shared/async/delay.js';

const options = { pollMs: 10, heartbeatMs: 30, authRefreshMs: 30, writeTimeoutMs: 10,
  maxStreamMs: 10000, maxStreams: 2, maxStreamsPerScope: 1, maxBufferedBytes: 8192, eventBytes: 4096 };

test('stream admission counts per owner, releases idempotently and closes only connection controllers', () => {
  const sessions = new StreamSessions(options); const owner = testScope(); const other = testScope('other');
  const a = new AbortController(); const b = new AbortController(); let destroyed = 0;
  const release = sessions.acquire(owner, a, () => { destroyed += 1; });
  assert.throws(() => sessions.acquire(owner, new AbortController(), () => undefined), error => error instanceof ApiFailure && error.code === 'RATE_LIMITED');
  release(); release(); const again = sessions.acquire(owner, a, () => { destroyed += 1; });
  const second = sessions.acquire(other, b, () => { destroyed += 1; }); sessions.close();
  assert.ok(a.signal.aborted && b.signal.aborted); assert.equal(destroyed, 2); again(); second();
  assert.throws(() => sessions.acquire(owner, new AbortController(), () => undefined), error => error instanceof ApiFailure && error.code === 'CONNECTION_UNAVAILABLE');
});

test('maximum subscription lifetime aborts transport without requiring a worker or user cancellation', async () => {
  const controller = new AbortController(); let closed = 0;
  const sessions = new StreamSessions({ ...options, maxStreamMs: 10 });
  const release = sessions.acquire(testScope(), controller, () => { closed += 1; });
  await delay(25); assert.ok(controller.signal.aborted); assert.equal(closed, 1); release(); sessions.close();
});
