import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMessage } from '../../../src/contracts/messages/parse-message.js';
import { parseId } from '../../../src/contracts/identity/ids.js';
import { RUN_STATUSES } from '../../../src/contracts/state/run-state.js';
import { RUN_EVENT_TYPES } from '../../../src/contracts/state/events.js';
import { API_ERROR_STATUS } from '../../../src/contracts/api/errors.js';
import { assertValid, validates } from './validate.js';
import { eventFixture, eventPayloads, now, responseFixtures, run } from './fixtures.js';

test('every public response fixture and existing run status validates', () => {
  for (const [name, value] of Object.entries(responseFixtures)) assertValid(name, value);
  for (const status of RUN_STATUSES) assertValid('RunSnapshot', { ...run, status });
  assert.equal(validates('RunSnapshot', { ...run, status: 'waiting_for_device' }), false);
  assert.equal(validates('RunSnapshot', { ...run, revision: Number.MAX_SAFE_INTEGER + 1 }), false);
  assert.equal(validates('ConnectionView', { ...responseFixtures.ConnectionView, secretRef: 'private-ref' }), false);
  const approvalWithoutArguments: Record<string, unknown> = { ...responseFixtures.ApprovalView };
  delete approvalWithoutArguments['arguments'];
  assert.equal(validates('ApprovalView', approvalWithoutArguments), false, 'approval preview needs concrete final parameters');
});

test('all durable event kinds have typed payloads and immutable scope-neutral envelopes', () => {
  assert.deepEqual(Object.keys(eventPayloads), RUN_EVENT_TYPES);
  for (const type of Object.keys(eventPayloads) as (keyof typeof eventPayloads)[]) {
    const value = eventFixture(type);
    assertValid('DurableEvent', value);
    assert.equal(validates('DurableEvent', { ...value, schemaVersion: 2 }), false);
    assert.equal(validates('DurableEvent', { ...value, sequence: 0 }), false);
    assert.equal(validates('DurableEvent', { ...value, payload: {} }), false, type);
    assert.equal(validates('DurableEvent', { ...value, actorId: 'override' }), false);
  }
});

test('tool events need correlation; unknown execution cannot be claimed as completion', () => {
  const value: Record<string, unknown> = { ...eventFixture('tool.completed') };
  delete value['toolCallId'];
  assert.equal(validates('DurableEvent', value), false);
  const unknown = eventFixture('tool.failed');
  assertValid('DurableEvent', unknown);
  assert.equal(validates('DurableEvent', { ...unknown, type: 'tool.completed' }), false);
  assert.equal(validates('DurableEvent', { ...unknown, payload: {
    outcome: 'unknown', resultMessageId: 'r', failure: { code: 'CONNECTION_UNAVAILABLE', message: 'Disconnected' },
  } }), false);
});

test('tool/private metadata and system instructions are excluded from public messages/events', () => {
  const result = { id: 'result', role: 'tool', toolCallId: 'c', outcome: 'success', content: [] };
  assertValid('PublicMessage', result);
  assert.deepEqual(parseMessage(result), result);
  assert.equal(validates('PublicMessage', { ...result, privateMeta: { token: 'secret' } }), false);
  assert.equal(validates('PublicMessage', { id: 'system', role: 'system', content: [{ type: 'text', text: 'Private instructions' }] }), false);
  const event = eventFixture('message.completed');
  assert.equal(validates('DurableEvent', { ...event, payload: { message: { ...result, rawSdkError: 'private' } } }), false);
});

test('ephemeral text deltas cannot impersonate durable IDs, sequence or cursor advancement', () => {
  const delta = { schemaVersion: 1, type: 'message.delta', runId: 'r', conversationId: 'c', stepId: 's',
    modelCallId: 'mc', messageId: 'm', occurredAt: now, delta: 'partial' };
  assertValid('MessageDelta', delta);
  assert.equal(validates('DurableEvent', delta), false);
  for (const extra of [{ eventId: 'fake' }, { sequence: 1 }, { eventCursor: 'cursor' }]) {
    assert.equal(validates('MessageDelta', { ...delta, ...extra }), false);
  }
});

test('stable error codes/statuses include actionable revision and expired-cursor recovery', () => {
  for (const code of Object.keys(API_ERROR_STATUS)) {
    const recovery = code === 'REVISION_CONFLICT'
      ? { currentRevision: 3, action: 'refresh_revision' }
      : { runId: 'run-1', action: 'fetch_snapshot' };
    assertValid('ErrorResponse', { error: { code, message: 'Safe message', requestId: 'request-1', retryable: false, recovery } });
  }
  assert.equal(API_ERROR_STATUS.EVENT_CURSOR_EXPIRED, 410);
  assert.equal(API_ERROR_STATUS.IDEMPOTENCY_CONFLICT, 409);
  for (const code of ['REVISION_CONFLICT', 'EVENT_CURSOR_EXPIRED']) {
    assert.equal(validates('ErrorResponse', { error: { code, message: 'Safe', requestId: 'r', retryable: false } }), false);
  }
  assert.equal(validates('ErrorResponse', { error: { code: 'SDK_INTERNAL', message: 'Raw', requestId: 'r', retryable: false } }), false);
});

test('wire IDs follow internal opaque identifier rules without assuming UUIDs', () => {
  for (const id of ['message-1', 'provider:call/42', 'pesan-日本語']) {
    assert.equal(parseId('message', id), id);
    assertValid('PublicMessage', { id, role: 'user', content: [{ type: 'text', text: 'Hello' }] });
  }
  for (const id of ['', 'leading space', 'hidden\u200bseparator', 'line\nbreak', 'x'.repeat(257)]) {
    assert.equal(validates('PublicMessage', { id, role: 'user', content: [{ type: 'text', text: 'Hello' }] }), false);
  }
});
