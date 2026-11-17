import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { parseId } from '../../../src/contracts/identity/ids.js';
import { createDatabase } from './database.js';
import type { IsolatedDatabase } from './database.js';
import { AT, digest, event, other, overlappingPool, owner, seedConnection, seedRun, stores, tenanted } from './fixtures.js';

let db: IsolatedDatabase;
before(async () => { db = await createDatabase(); });
after(async () => { await db.drop(); });

test('conversations and runs round-trip; foreign actors and tenants see not_found', async () => {
  const s = stores(db.pool);
  const id = parseId('conversation', 'conv-roundtrip');
  const created = await s.conversations.create(owner, { id, title: 'Stock', at: AT });
  assert.ok(created.ok);
  assert.deepEqual(created.value, { id, title: 'Stock', owner: { actorId: 'actor-a', appId: 'app-a' }, revision: 1, createdAt: AT, updatedAt: AT });
  assert.deepEqual(await s.conversations.get(owner, id), created);
  for (const scope of [other, tenanted]) {
    assert.equal((await s.conversations.get(scope, id)).ok, false);
    const run = await s.runs.create(scope, { id: parseId('run', `run-x-${scope.actorId}-${scope.tenantId ?? ''}`), conversationId: id, at: AT, events: [] });
    assert.deepEqual(run, { ok: false, error: { code: 'not_found', message: 'Record not found' } });
  }
  const { runId } = await seedRun(db.pool, owner, 'rt');
  const run = await s.runs.get(owner, runId);
  assert.ok(run.ok && run.value.status === 'running' && run.value.revision === 2);
  assert.deepEqual(await s.runs.get(other, runId), { ok: false, error: { code: 'not_found', message: 'Record not found' } });
});

test('stale revisions conflict with the current revision and write nothing', async () => {
  const s = stores(db.pool);
  const { runId } = await seedRun(db.pool, owner, 'stale');
  const stale = await s.runs.transition(owner, runId, { to: 'completed', expectedRevision: 1, at: AT, events: [event('run.completed')] });
  assert.deepEqual(stale, { ok: false, error: { code: 'revision_conflict', message: 'Expected revision is stale', currentRevision: 2 } });
  const events = await s.events.readAfter(owner, runId, 0, 10);
  assert.ok(events.ok);
  assert.deepEqual(events.value.map(item => [item.sequence, item.type]), [[1, 'run.queued'], [2, 'run.started']]);
});

test('concurrent compare-and-set: exactly one writer wins', async () => {
  const s = stores(db.pool);
  const racing = stores(overlappingPool(db.pool));
  const { runId } = await seedRun(db.pool, owner, 'race');
  const results = await Promise.all(['completed', 'failed', 'partial', 'cancelled'].map(to =>
    racing.runs.transition(owner, runId, { to: to as 'completed', expectedRevision: 2, at: AT, events: [event('run.completed')] })));
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.ok(results.filter(result => !result.ok).every(result => !result.ok && result.error.code === 'revision_conflict'));
  const events = await s.events.readAfter(owner, runId, 0, 10);
  assert.ok(events.ok && events.value.length === 3);
});

test('settlement is read in the transaction: unknown blocks completed, terminal runs stay terminal', async () => {
  const s = stores(db.pool);
  const tool = await seedConnection(db.pool, owner, 'conn-settle');
  const { runId } = await seedRun(db.pool, owner, 'settle');
  const callId = parseId('tool_call', 'call-settle');
  const stepId = parseId('step', 'step-settle');
  assert.ok((await s.calls.propose(owner, { id: callId, runId, stepId, tool, argumentsDigest: digest, requiresApproval: false, at: AT })).ok);
  const pending = await s.runs.transition(owner, runId, { to: 'completed', expectedRevision: 2, at: AT, events: [] });
  assert.equal(!pending.ok && pending.error.code, 'unresolved_tool_calls');
  for (const [to, revision] of [['ready', 1], ['dispatching', 2], ['unknown', 3]] as const) {
    assert.ok((await s.calls.transition(owner, runId, callId, { to, expectedRevision: revision, at: AT, events: [] })).ok);
  }
  const completed = await s.runs.transition(owner, runId, { to: 'completed', expectedRevision: 2, at: AT, events: [] });
  assert.equal(!completed.ok && completed.error.code, 'unresolved_tool_calls');
  const partial = await s.runs.transition(owner, runId, { to: 'partial', expectedRevision: 2, at: AT, events: [event('run.partial')] });
  assert.ok(partial.ok && partial.value.status === 'partial');
  const revived = await s.runs.transition(owner, runId, { to: 'running', expectedRevision: 3, at: AT, events: [] });
  assert.equal(!revived.ok && revived.error.code, 'invalid_transition');
});

test('cancellation intent is idempotent and appends events only when it changes the run', async () => {
  const s = stores(db.pool);
  const { runId } = await seedRun(db.pool, owner, 'cancel');
  const first = await s.runs.requestCancellation(owner, runId, AT + 5, [event('run.cancelled')]);
  assert.ok(first.ok && first.value.cancelRequestedAt === AT + 5 && first.value.revision === 3);
  const again = await s.runs.requestCancellation(owner, runId, AT + 9, [event('run.cancelled')]);
  assert.deepEqual(again, first);
  const events = await s.events.readAfter(owner, runId, 0, 10);
  assert.ok(events.ok && events.value.length === 3);
  assert.equal((await s.runs.requestCancellation(other, runId, AT, [])).ok, false);
});

test('event cursor pages are ascending, bounded and owner-checked', async () => {
  const s = stores(db.pool);
  const { runId } = await seedRun(db.pool, owner, 'cursor');
  for (let index = 0; index < 3; index += 1) {
    await s.runs.requestCancellation(owner, runId, AT, []);
  }
  const page = await s.events.readAfter(owner, runId, 1, 1);
  assert.ok(page.ok);
  assert.deepEqual(page.value.map(item => item.sequence), [2]);
  assert.equal(page.value[0]?.occurredAt, AT);
  assert.equal((await s.events.readAfter(other, runId, 0, 10)).ok, false);
  await assert.rejects(s.events.readAfter(owner, runId, -1, 10), RangeError);
  await assert.rejects(s.events.readAfter(owner, runId, 0, 0), RangeError);
});
