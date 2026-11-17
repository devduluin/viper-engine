import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PostgresApprovalStore } from '../../../src/adapters/persistence/postgres/approval-store.js';
import type { SqlConnection, SqlPool } from '../../../src/adapters/persistence/postgres/sql-client.js';
import { parseId } from '../../../src/contracts/identity/ids.js';
import { APPROVAL_ARGUMENTS_DIGEST, parseArgumentsDigest } from '../../../src/contracts/state/approval-state.js';
import { createFingerprint } from '../../../src/shared/fingerprints/fingerprint.js';
import { createDatabase } from './database.js';
import type { IsolatedDatabase } from './database.js';
import { pendingApproval } from './approval-fixtures.js';
import { AT, owner, proposalSnapshot } from './fixtures.js';

let db: IsolatedDatabase;
before(async () => { db = await createDatabase(); });
after(async () => { await db.drop(); });

function mutateOnAccess(pool: SqlPool, mutate: () => void): SqlPool {
  const wrap = (tx: SqlConnection): SqlConnection => ({ release: error => tx.release(error), async query(text, values) {
    const result = await tx.query(text, values);
    if (text.startsWith('SELECT c.auth_state')) mutate();
    return result;
  } });
  return { query: (text, values) => pool.query(text, values), connect: async () => wrap(await pool.connect()) };
}

test('a caller cannot change approval arguments or schema between digest validation and insertion', async () => {
  const { s, binding, approvalId } = await pendingApproval(db, 'mutable-proposal');
  assert.ok((await s.approvals.decide(owner, approvalId, { to: 'rejected', expectedRevision: 1, at: AT, events: [] })).ok);
  const args = { id: 'a' };
  const snapshot = { inputSchema: { type: 'object' }, description: 'Original' };
  const subject = new PostgresApprovalStore(mutateOnAccess(db.pool, () => { args.id = 'forged'; snapshot.description = 'Forged'; }));
  const proposed = await subject.propose(owner, { id: parseId('approval', 'immutable-proposal'), binding,
    arguments: args, toolSnapshot: snapshot, at: AT, expiresAt: AT + 60000, events: [] });
  assert.ok(proposed.ok);
  assert.deepEqual(proposed.value.arguments, { id: 'a' });
  assert.equal(proposed.value.toolSnapshot?.description, 'Original');
});

test('parameter amendments keep the validated arguments across awaited access checks', async () => {
  const { approvalId } = await pendingApproval(db, 'mutable-revision');
  const args = { id: 'a', count: 5 };
  const digest = parseArgumentsDigest(createFingerprint(args, APPROVAL_ARGUMENTS_DIGEST));
  const subject = new PostgresApprovalStore(mutateOnAccess(db.pool, () => { args.count = 1000; }));
  const revised = await subject.revise(owner, approvalId, { expectedRevision: 1, at: AT,
    newToolCallId: parseId('tool_call', 'immutable-revision'), newApprovalId: parseId('approval', 'immutable-revision'),
    arguments: args, argumentsDigest: digest, expiresAt: AT + 60000, events: [] });
  assert.ok(revised.ok);
  assert.deepEqual(revised.value.approval.arguments, { id: 'a', count: 5 });
  assert.equal(revised.value.toolCall.argumentsDigest, digest);
});

test('disabled and foreign-private servers block approval consumption with zero attempts', async () => {
  for (const mode of ['disabled', 'private']) {
    const { s, approvalId, binding, runId, callId, tool } = await pendingApproval(db, `server-${mode}`);
    // Test fixtures share an app-level server; restore it before creating the next proposal.
    assert.ok((await s.approvals.decide(owner, approvalId, { to: 'accepted', expectedRevision: 1, at: AT, events: [] })).ok);
    assert.ok((await s.calls.transition(owner, runId, callId, { to: 'ready', expectedRevision: 2, at: AT, events: [] })).ok);
    await db.pool.query(`UPDATE viper_engine.mcp_servers SET enabled = $2, owner_actor_id = $3, revision = revision + 1 WHERE id = $1`,
      [tool.serverId, mode !== 'disabled', mode === 'private' ? 'another-actor' : null]);
    const result = await s.approvals.consumeForDispatch(owner, approvalId, { binding, expectedRevision: 2, toolCallExpectedRevision: 3, at: AT, events: [] });
    assert.ok(!result.ok && result.error.code === 'access_revoked');
    const stored = await s.calls.get(owner, runId, callId);
    assert.ok(stored.ok && stored.value.attempts === 0 && stored.value.status === 'ready');
    await db.pool.query(`UPDATE viper_engine.mcp_servers SET enabled = true, owner_actor_id = NULL, revision = revision + 1 WHERE id = $1`, [tool.serverId]);
  }
});

test('backdated proposal creation refuses a deadline already passed by database time', async () => {
  const { s, binding, tool, runId } = await pendingApproval(db, 'expired-clock');
  // Create separate historical rows through the store; immutable expiry is never changed in SQL.
  const oldAt = Date.now() - 5000;
  const result = await s.approvals.propose(owner, { id: parseId('approval', 'already-expired'), binding,
    ...proposalSnapshot, at: oldAt, expiresAt: oldAt + 1000, events: [] });
  assert.ok(!result.ok && result.error.code === 'approval_expired');
  assert.ok(tool.serverId && runId);
});

test('backdated acceptance and consumption cannot revive expiry before the sweeper runs', async () => {
  for (const consume of [false, true]) {
    const { s, binding, approvalId, runId, callId } = await pendingApproval(db, `expiry-${consume}`);
    assert.ok((await s.approvals.decide(owner, approvalId, { to: 'rejected', expectedRevision: 1, at: AT, events: [] })).ok);
    const at = Date.now();
    const id = parseId('approval', `wall-clock-${consume}`);
    assert.ok((await s.approvals.propose(owner, { id, binding, ...proposalSnapshot,
      at, expiresAt: at + 250, events: [] })).ok);
    if (consume) {
      assert.ok((await s.approvals.decide(owner, id, { to: 'accepted', expectedRevision: 1, at, events: [] })).ok);
      assert.ok((await s.calls.transition(owner, runId, callId, { to: 'ready', expectedRevision: 2, at: AT, events: [] })).ok);
    }
    await db.pool.query('SELECT pg_sleep(0.35)');
    const result = consume
      ? await s.approvals.consumeForDispatch(owner, id, { binding, expectedRevision: 2, toolCallExpectedRevision: 3, at, events: [] })
      : await s.approvals.decide(owner, id, { to: 'accepted', expectedRevision: 1, at, events: [] });
    assert.ok(!result.ok && result.error.code === 'approval_expired');
    const call = await s.calls.get(owner, runId, callId);
    assert.ok(call.ok && call.value.attempts === 0);
  }
});
