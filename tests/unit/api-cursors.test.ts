import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SignedApiCursors } from '../../src/adapters/http/cursors.js';
import { ApiFailure } from '../../src/contracts/api/failure.js';
import { TestClock } from '../support/agent/identity.js';
import { testScope } from '../support/agent/setup.js';

test('signed cursors bind kind, owner, app, tenant, resource and deployment key', () => {
  const clock = new TestClock(); const key = Buffer.alloc(32, 1); const cursors = new SignedApiCursors(key, clock, 1000);
  key.fill(0); // Constructor captures its own key bytes.
  const owner = testScope(); const token = cursors.issue(owner, 'event', 'run-1', '4');
  assert.match(token, /^[A-Za-z0-9_-]{1,2048}$/);
  assert.equal(cursors.read(owner, 'event', 'run-1', token), '4');
  for (const operation of [() => cursors.read(owner, 'messages', 'run-1', token),
    () => cursors.read(owner, 'event', 'run-2', token), () => cursors.read(testScope('other'), 'event', 'run-1', token),
    () => cursors.read(testScope('actor-a', 'other-app'), 'event', 'run-1', token),
    () => cursors.read(testScope('actor-a', 'app-a', 'tenant'), 'event', 'run-1', token),
    () => cursors.read(owner, 'event', 'run-1', `${token.slice(0, -10)}tampered`),
    () => new SignedApiCursors(Buffer.alloc(32, 2), clock, 1000).read(owner, 'event', 'run-1', token)]) {
    assert.throws(operation, error => error instanceof ApiFailure && error.code === 'INVALID_CURSOR');
  }
  assert.throws(() => new SignedApiCursors(Buffer.alloc(8), clock, 1000));
});

test('cursor expiry distinguishes event snapshot recovery from invalid page cursors', () => {
  const clock = new TestClock(); const cursors = new SignedApiCursors(Buffer.alloc(32), clock, 1000); const owner = testScope();
  const event = cursors.issue(owner, 'event', 'run', '0'); const page = cursors.issue(owner, 'messages', 'conv', '1');
  clock.advance(1000);
  assert.throws(() => cursors.read(owner, 'event', 'run', event), error => {
    assert.ok(error instanceof ApiFailure); assert.equal(error.code, 'EVENT_CURSOR_EXPIRED');
    assert.deepEqual(error.recovery, { runId: 'run', action: 'fetch_snapshot' }); return true;
  });
  assert.throws(() => cursors.read(owner, 'messages', 'conv', page), error => error instanceof ApiFailure && error.code === 'INVALID_CURSOR');
});
