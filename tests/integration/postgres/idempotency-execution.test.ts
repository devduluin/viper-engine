import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PostgresExecutionLedger } from '../../../src/adapters/persistence/postgres/execution-ledger.js';
import { PostgresIdempotencyStore } from '../../../src/adapters/persistence/postgres/idempotency-store.js';
import { parseId } from '../../../src/contracts/identity/ids.js';
import { createDatabase } from './database.js';
import type { IsolatedDatabase } from './database.js';
import { AT, digest, other, overlappingPool, owner, seedConnection, seedRun, stores, tenanted } from './fixtures.js';

let db: IsolatedDatabase;
before(async () => { db = await createDatabase(); });
after(async () => { await db.drop(); });

const fp = (char: string) => char.repeat(64);
const request = (key: string, fingerprint = fp('a')) => ({ operation: 'runs.create', key, fingerprint });
const TTL = 86_400_000;

async function started(store: PostgresIdempotencyStore, key: string): Promise<string> {
  const result = await store.begin(owner, { ...request(key), at: AT, ttlMs: TTL });
  assert.ok(result.ok && result.value.status === 'started');
  return result.value.claimId;
}

test('idempotency: started once, then replay or in_progress; a changed payload conflicts', async () => {
  const store = new PostgresIdempotencyStore(db.pool);
  const claimId = await started(store, 'k1');
  assert.deepEqual(await store.begin(owner, { ...request('k1'), at: AT, ttlMs: TTL }), { ok: true, value: { status: 'in_progress' } });
  const conflict = await store.begin(owner, { ...request('k1', fp('b')), at: AT, ttlMs: TTL });
  assert.ok(!conflict.ok && conflict.error.code === 'idempotency_conflict');
  assert.ok((await store.complete(owner, { ...request('k1'), claimId, resourceRef: 'run/r-1' })).ok);
  assert.deepEqual(await store.begin(owner, { ...request('k1'), at: AT + 1, ttlMs: TTL }), { ok: true, value: { status: 'replay', resourceRef: 'run/r-1' } });
  assert.ok((await store.complete(owner, { ...request('k1'), claimId, resourceRef: 'run/r-1' })).ok);
  assert.equal((await store.complete(owner, { ...request('k1'), claimId, resourceRef: 'run/r-2' })).ok, false);
  for (const scope of [other, tenanted]) {
    const scoped = await store.begin(scope, { ...request('k1', fp('c')), at: AT, ttlMs: TTL });
    assert.ok(scoped.ok && scoped.value.status === 'started');
  }
});

test('idempotency: concurrent first requests start exactly once; expiry and abandon allow a retry', async () => {
  const racing = new PostgresIdempotencyStore(overlappingPool(db.pool));
  const store = new PostgresIdempotencyStore(db.pool);
  const results = await Promise.all(Array.from({ length: 5 }, () => racing.begin(owner, { ...request('k2'), at: AT, ttlMs: TTL })));
  assert.deepEqual(results.map(result => result.ok && result.value.status).sort(), ['in_progress', 'in_progress', 'in_progress', 'in_progress', 'started']);
  const first = results.find(result => result.ok && result.value.status === 'started');
  assert.ok(first?.ok && first.value.status === 'started');
  assert.deepEqual(await store.abandon(owner, { ...request('k2'), claimId: first.value.claimId }), { ok: true, value: { abandoned: true } });
  const claimId = await started(store, 'k2');
  assert.ok((await store.complete(owner, { ...request('k2'), claimId, resourceRef: 'run/x' })).ok);
  assert.deepEqual(await store.abandon(owner, { ...request('k2'), claimId }), { ok: true, value: { abandoned: false } });
  const later = await store.begin(owner, { ...request('k2', fp('d')), at: AT + TTL, ttlMs: TTL });
  assert.ok(later.ok && later.value.status === 'started' && later.value.claimId !== claimId);
  await assert.rejects(store.begin(owner, { ...request('k3', 'not-a-digest'), at: AT, ttlMs: TTL }), /fingerprint/);
});

test('steps are gap-free; model calls record outcome and usage exactly once', async () => {
  const { runId } = await seedRun(db.pool, owner, 'exec');
  const ledger = new PostgresExecutionLedger(db.pool);
  const step = (index: number) => ({ runId, stepId: parseId('step', `exec-step-${index}`), stepIndex: index, at: AT });
  assert.ok((await ledger.startStep(owner, step(1))).ok);
  const gap = await ledger.startStep(owner, step(3));
  assert.ok(!gap.ok && gap.error.code === 'sequence_conflict');
  assert.equal((await ledger.startStep(other, step(2))).ok, false);
  const modelCallId = parseId('model_call', 'exec-mc-1');
  assert.ok((await ledger.startModelCall(owner, { runId, stepId: step(1).stepId, modelCallId, attempt: 1, provider: 'anthropic', model: 'claude-opus-5-5', at: AT })).ok);
  const usage = { source: 'provider', inputTokens: 422, outputTokens: 54, totalTokens: 476 } as const;
  assert.ok((await ledger.finishModelCall(owner, { runId, modelCallId, outcome: 'succeeded', usage, at: AT + 5 })).ok);
  const twice = await ledger.finishModelCall(owner, { runId, modelCallId, outcome: 'failed', failureCode: 'timeout', usage, at: AT + 6 });
  assert.ok(!twice.ok && twice.error.code === 'invalid_transition');
  assert.ok((await ledger.finishStep(owner, { runId, stepId: step(1).stepId, decision: 'tool_calls', at: AT + 7 })).ok);
  const row = await db.pool.query(`SELECT outcome, input_tokens, output_tokens, total_tokens, usage_source FROM viper_engine.model_calls WHERE id = $1`, [modelCallId]);
  assert.deepEqual(row.rows[0], { outcome: 'succeeded', input_tokens: '422', output_tokens: '54', total_tokens: '476', usage_source: 'provider' });
});

test('attempts: one row per dispatch, settled once, kept after the run ends', async () => {
  const { runId } = await seedRun(db.pool, owner, 'attempts');
  const s = stores(db.pool);
  const tool = await seedConnection(db.pool, owner, 'conn-attempts');
  const callId = parseId('tool_call', 'call-attempts');
  assert.ok((await s.calls.propose(owner, { id: callId, runId, stepId: parseId('step', 's'), tool, argumentsDigest: digest, requiresApproval: false, at: AT })).ok);
  const steps = [['ready', 1], ['dispatching', 2], ['retry_wait', 3, 'known_not_applied'], ['dispatching', 4], ['succeeded', 5]] as const;
  for (const [to, revision, evidence] of steps) {
    const result = await s.calls.transition(owner, runId, callId, { to, expectedRevision: revision, at: AT + revision, events: [], ...(evidence ? { evidence } : {}) });
    assert.ok(result.ok, to);
  }
  assert.ok((await s.runs.transition(owner, runId, { to: 'completed', expectedRevision: 2, at: AT + 9, events: [] })).ok);
  const attempts = await new PostgresExecutionLedger(db.pool).listToolCallAttempts(owner, runId, callId);
  assert.ok(attempts.ok);
  assert.deepEqual(attempts.value.map(item => [item.attempt, item.dispatchedAt, item.resultKind, item.settledAt]),
    [[1, AT + 2, 'retry_wait', AT + 3], [2, AT + 4, 'succeeded', AT + 5]]);
  await assert.rejects(db.pool.query(`UPDATE viper_engine.tool_call_attempts SET result_kind = 'failed' WHERE run_id = $1`, [runId]), /already settled/);
  await assert.rejects(db.pool.query(`DELETE FROM viper_engine.tool_call_attempts WHERE run_id = $1`, [runId]), /append-only/);
  assert.equal((await new PostgresExecutionLedger(db.pool).listToolCallAttempts(other, runId, callId)).ok, false);
});
