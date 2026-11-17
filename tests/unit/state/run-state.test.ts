import assert from 'node:assert/strict';
import test from 'node:test';
import { checkNextEventSequence } from '../../../src/contracts/state/events.js';
import { checkOwnership } from '../../../src/contracts/state/owner.js';
import { checkExpectedRevision, parseRevision } from '../../../src/contracts/state/result.js';
import { checkRunSettlement, RUN_STATUSES, RUN_TRANSITIONS } from '../../../src/contracts/state/run-state.js';
import type { RunStatus } from '../../../src/contracts/state/run-state.js';
import { applyRunTransition, requestRunCancellation } from '../../../src/contracts/state/transitions.js';
import { ownerFromScope } from '../../../src/contracts/state/owner.js';
import { runRecord, scope, T0 } from './fixtures.js';

const TERMINAL: RunStatus[] = ['completed', 'partial', 'failed', 'cancelled'];

test('accepted transition bumps revision by one and leaves the input record untouched', () => {
  const record = runRecord();
  const result = applyRunTransition(record, scope(), { expectedRevision: 3, to: 'waiting_for_input', at: T0 + 5, toolCalls: [] });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.status, 'waiting_for_input');
  assert.equal(result.value.revision, 4);
  assert.equal(result.value.updatedAt, T0 + 5);
  assert.equal(Object.isFrozen(result.value), true);
  assert.equal(record.status, 'running');
});

test('stale or future expected revision is a conflict that reports the current revision', () => {
  for (const expected of [2, 4]) {
    const result = applyRunTransition(runRecord(), scope(), { expectedRevision: expected, to: 'completed', at: T0, toolCalls: [] });
    assert.deepEqual(result.ok ? undefined : result.error, {
      code: 'revision_conflict', message: 'Expected revision is stale', currentRevision: 3,
    });
  }
  assert.throws(() => checkExpectedRevision(1, 0), /positive safe integer/);
  assert.throws(() => parseRevision(1.5), /positive safe integer/);
});

test('another owner sees not_found before any revision or status detail leaks', () => {
  const others = [scope('actor-2'), scope('actor-1', 'tenant-1')];
  for (const other of others) {
    const result = applyRunTransition(runRecord(), other, { expectedRevision: 99, to: 'queued', at: T0, toolCalls: [] });
    assert.equal(result.ok ? undefined : result.error.code, 'not_found');
  }
  const tenantOwner = ownerFromScope(scope('actor-1', 'tenant-1'));
  assert.equal(checkOwnership(tenantOwner, scope('actor-1'))?.code, 'not_found', 'tenant absence never matches a tenant');
  assert.equal(checkOwnership(tenantOwner, scope('actor-1', 'tenant-1')), undefined);
});

test('terminal runs have no outgoing transition, so late results cannot revive them', () => {
  for (const from of TERMINAL) {
    for (const to of RUN_STATUSES) {
      const result = applyRunTransition(runRecord({ status: from }), scope(), { expectedRevision: 3, to, at: T0, toolCalls: [] });
      assert.equal(result.ok ? undefined : result.error.code, 'invalid_transition', `${from} -> ${to}`);
    }
  }
  assert.deepEqual(RUN_TRANSITIONS.queued, ['running', 'cancelled']);
});

test('terminal targets require settled tool calls; completed also refuses unknown outcomes', () => {
  for (const pending of ['proposed', 'awaiting_approval', 'ready', 'dispatching', 'retry_wait'] as const) {
    for (const to of TERMINAL) assert.equal(checkRunSettlement(to, ['succeeded', pending])?.code, 'unresolved_tool_calls');
  }
  assert.equal(checkRunSettlement('completed', ['succeeded', 'unknown'])?.code, 'unresolved_tool_calls');
  for (const to of ['partial', 'failed', 'cancelled'] as const) assert.equal(checkRunSettlement(to, ['unknown', 'failed']), undefined);
  assert.equal(checkRunSettlement('completed', ['succeeded', 'failed', 'rejected', 'cancelled']), undefined);
  assert.equal(checkRunSettlement('waiting_for_approval', ['awaiting_approval']), undefined);
});

test('cancellation is durable, idempotent intent and a no-op on terminal runs', () => {
  const first = requestRunCancellation(runRecord(), scope(), T0 + 1);
  assert.ok(first.ok);
  if (!first.ok) return;
  assert.equal(first.value.cancelRequestedAt, T0 + 1);
  assert.equal(first.value.status, 'running', 'intent does not jump the status');
  assert.equal(first.value.revision, 4);
  const again = requestRunCancellation(first.value, scope(), T0 + 2);
  assert.ok(again.ok && again.value === first.value);
  const done = runRecord({ status: 'completed' });
  const noop = requestRunCancellation(done, scope(), T0 + 3);
  assert.ok(noop.ok && noop.value === done);
  const foreign = requestRunCancellation(runRecord(), scope('actor-2'), T0);
  assert.equal(foreign.ok ? undefined : foreign.error.code, 'not_found');
});

test('event sequences start at 1 and must be gap-free per run', () => {
  assert.equal(checkNextEventSequence(0, 1), undefined);
  assert.equal(checkNextEventSequence(41, 42), undefined);
  for (const [last, next] of [[0, 0], [0, 2], [5, 5], [5, 7], [-1, 0]] as const) {
    assert.equal(checkNextEventSequence(last, next)?.code, 'sequence_conflict');
  }
});

test('event sequences and revision increments cannot overflow safe integer identities', () => {
  assert.equal(checkNextEventSequence(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1)?.code, 'sequence_conflict');
  assert.equal(checkNextEventSequence(Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER), undefined);
  const record = runRecord({ revision: Number.MAX_SAFE_INTEGER });
  assert.throws(() => applyRunTransition(record, scope(), {
    expectedRevision: Number.MAX_SAFE_INTEGER, to: 'completed', at: T0, toolCalls: [],
  }), /safe integer range/);
  assert.equal(record.revision, Number.MAX_SAFE_INTEGER);
});
