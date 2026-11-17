import assert from 'node:assert/strict';
import { test } from 'node:test';
import { driver, setupRun, clock } from './durable-fixtures.js';
import { createDatabase } from './database.js';
import { owner, other, stores } from './fixtures.js';
import { parseId } from '../../../src/contracts/identity/ids.js';
import { parseMessage } from '../../../src/contracts/messages/parse-message.js';
import { PostgresRunJournal } from '../../../src/adapters/persistence/postgres/run-journal.js';
import { PostgresMessageStore } from '../../../src/adapters/persistence/postgres/message-store.js';
import { PostgresRunLeaseStore } from '../../../src/adapters/persistence/postgres/lease-store.js';
import { APPROVAL_ARGUMENTS_DIGEST, parseArgumentsDigest } from '../../../src/contracts/state/approval-state.js';
import { createFingerprint } from '../../../src/shared/fingerprints/fingerprint.js';
import { callsOf, finalText, StubMcp, success } from '../../unit/runtime/harness.js';
import { DurableRunDriver } from '../../../src/application/durable/driver.js';

test('journal rolls back message, revision and event when a later ledger command conflicts', async () => {
  const db = await createDatabase();
  try {
    const run = await setupRun(db.pool, 'journal-rollback');
    const claim = await new PostgresRunLeaseStore(db.pool).claimNext('journal', clock.now(), 30000); assert.ok(claim);
    const journal = new PostgresRunJournal(db.pool);
    const h = await driver(db.pool, []);
    const before = await h.deps.checkpoints.load(owner, run.runId); assert.ok(before.ok);
    const input = { lease: claim.lease, at: clock.now(), expectedRevision: 0, state: { version: 1 }, commands: [
      { kind: 'messages' as const, input: { expectedRevision: before.value.conversationRevision, at: clock.now(),
        messages: [parseMessage({ id: 'must-roll-back', role: 'assistant', content: [{ type: 'text', text: 'No partial commit' }] })] } },
      { kind: 'tool_transition' as const, id: parseId('tool_call', 'absent'), input: { to: 'ready' as const, expectedRevision: 1, at: clock.now(), events: [] } },
    ] };
    const refused = await journal.commit(owner, run.runId, input);
    assert.ok(!refused.ok && refused.error.code === 'not_found');
    const after = await h.deps.checkpoints.load(owner, run.runId); assert.ok(after.ok);
    assert.deepEqual(after.value, before.value);
    const foreign = await journal.commit(other, run.runId, { ...input, commands: [] });
    assert.ok(!foreign.ok && foreign.error.code === 'not_found');
  } finally { await db.drop(); }
});

test('same-run concurrent message/event appends serialize without lock-upgrade deadlock', async () => {
  const db = await createDatabase();
  try {
    const run = await setupRun(db.pool, 'message-concurrency');
    const messages = new PostgresMessageStore(db.pool);
    const results = await Promise.all(['a', 'b'].map(id => messages.append(owner, run.conversationId, { runId: run.runId,
      expectedRevision: 2, at: clock.now(), messages: [parseMessage({ id, role: 'assistant', content: [{ type: 'text', text: id }] })],
      events: [{ eventId: parseId('run_event', `ev-${id}`), type: 'message.completed', occurredAt: clock.now(), payload: {} }] })));
    assert.equal(results.filter(result => result.ok).length, 1);
    assert.ok(results.some(result => !result.ok && result.error.code === 'revision_conflict'));
  } finally { await db.drop(); }
});

test('omitting runId cannot append late tool messages; another run cannot answer its calls', async () => {
  const db = await createDatabase();
  try {
    const run = await setupRun(db.pool, 'message-origin');
    const messages = new PostgresMessageStore(db.pool);
    const assistant = parseMessage({ id: 'origin-assistant', role: 'assistant', content: [], toolCalls: [{ id: 'origin-call', name: 'lookup', arguments: {} }] });
    assert.ok((await messages.append(owner, run.conversationId, { runId: run.runId, expectedRevision: 2, at: clock.now(), messages: [assistant] })).ok);
    const tool = parseMessage({ id: 'origin-result', role: 'tool', toolCallId: 'origin-call', outcome: 'success', content: [] });
    const omitted = await messages.append(owner, run.conversationId, { expectedRevision: 3, at: clock.now(), messages: [tool] });
    assert.ok(!omitted.ok && omitted.error.code === 'invalid_transition');
    const second = parseId('run', 'different-run');
    assert.ok((await stores(db.pool).runs.create(owner, { id: second, conversationId: run.conversationId, at: clock.now(), events: [] })).ok);
    const crossed = await messages.append(owner, run.conversationId, { runId: second, expectedRevision: 3, at: clock.now(), messages: [tool] });
    assert.ok(!crossed.ok && crossed.error.code === 'invalid_transition');
  } finally { await db.drop(); }
});

test('durable parameter amendment answers the old call and resumes only the new approved arguments', async () => {
  const db = await createDatabase();
  try {
    const run = await setupRun(db.pool, 'driver-revise');
    const first = await driver(db.pool, [callsOf(['old-call', 'lookup', { count: 10 }])], { policy: { decide: () => 'requires_approval' } });
    await first.driver.runOnce('revise-first');
    const cp = await first.deps.checkpoints.load(owner, run.runId); assert.ok(cp.ok);
    const old = cp.value.approvals[0]; assert.ok(old);
    const revised = await stores(db.pool).approvals.revise(owner, old.id, { expectedRevision: 1, at: clock.now(),
      newApprovalId: parseId('approval', 'new-approved'), newToolCallId: parseId('tool_call', 'new-call'),
      arguments: { count: 5 }, argumentsDigest: parseArgumentsDigest(createFingerprint({ count: 5 }, APPROVAL_ARGUMENTS_DIGEST)),
      expiresAt: clock.now() + 60000, events: [] });
    assert.ok(revised.ok);
    assert.ok((await stores(db.pool).approvals.decide(owner, revised.value.approval.id, { to: 'accepted', expectedRevision: 1, at: clock.now(), events: [] })).ok);
    assert.ok((await first.deps.runs.wake(owner, run.runId, { expectedRevision: cp.value.run.revision, at: clock.now(), events: [] })).ok);
    const next = await driver(db.pool, [finalText('Amended work done')], { policy: { decide: () => 'requires_approval' } });
    const result = await next.driver.runOnce('revise-next');
    assert.ok(result.kind === 'settled' && result.status === 'completed');
    assert.deepEqual(next.mcp.calls.map(call => [call.toolCallId, call.arguments]), [['new-call', { count: 5 }]]);
    const saved = await next.deps.checkpoints.load(owner, run.runId); assert.ok(saved.ok);
    assert.deepEqual(saved.value.history.filter(message => message.role === 'tool').map(message => message.toolCallId), ['old-call', 'new-call']);
  } finally { await db.drop(); }
});

test('renewal loss aborts a blocked worker before dispatch and returns work for recovery', async () => {
  const db = await createDatabase();
  try {
    await setupRun(db.pool, 'driver-lease-lost');
    const leases = new PostgresRunLeaseStore(db.pool);
    leases.renew = async () => ({ ok: false, error: { code: 'lease_lost', message: 'Fixture lease loss' } });
    const h = await driver(db.pool, [callsOf(['lost-call', 'lookup'])], { leases, leaseMs: 1000, heartbeatMs: 100,
      onEvent: event => event.type === 'tool_call_dispatching' ? new Promise(() => {}) : undefined });
    const result = await h.driver.runOnce('lease-lost');
    assert.equal(result.kind, 'yielded');
    assert.equal(h.mcp.calls.length, 0);
  } finally { await db.drop(); }
});

test('lease heartbeats keep ownership while a slow tool completes', async () => {
  const db = await createDatabase();
  try {
    await setupRun(db.pool, 'driver-heartbeat');
    const mcp = new StubMcp(async () => { await db.pool.query('SELECT pg_sleep(1.2)'); return success({ done: true }); });
    const h = await driver(db.pool, [callsOf(['slow-call', 'lookup']), finalText('Done')], { mcp, leaseMs: 1000, heartbeatMs: 100 });
    const result = await h.driver.runOnce('heartbeat');
    assert.ok(result.kind === 'settled' && result.status === 'completed');
    assert.equal(mcp.calls.length, 1);
  } finally { await db.drop(); }
});

test('cancellation winning a model-intent transaction rolls it back and restores the committed counters', async () => {
  const db = await createDatabase();
  try {
    const run = await setupRun(db.pool, 'cancel-intent-rollback');
    const h = await driver(db.pool, [finalText('Must not be requested')]);
    const journal = h.deps.journal;
    const raced = new DurableRunDriver({ ...h.deps, journal: { commit: async (scope, runId, input) => {
      if (input.commands.some(command => command.kind === 'step_start')) await h.deps.runs.requestCancellation(owner, run.runId, clock.now(), []);
      return journal.commit(scope, runId, input);
    } } });
    const result = await raced.runOnce('cancel-intent');
    assert.ok(result.kind === 'settled' && result.status === 'cancelled');
    assert.equal(h.model.requests.length, 0);
    const cp = await h.deps.checkpoints.load(owner, run.runId); assert.ok(cp.ok);
    assert.equal(cp.value.execution?.state['modelCalls'], 0);
    const audit = await db.pool.query('SELECT count(*)::int AS n FROM viper_engine.model_calls WHERE run_id = $1', [run.runId]);
    assert.equal(Reflect.get(Object(audit.rows[0]), 'n'), 0);
  } finally { await db.drop(); }
});
