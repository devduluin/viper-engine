import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PostgresCheckpointReader } from '../../../src/adapters/persistence/postgres/checkpoint-reader.js';
import { PostgresMessageStore } from '../../../src/adapters/persistence/postgres/message-store.js';
import { PostgresRunLeaseStore } from '../../../src/adapters/persistence/postgres/lease-store.js';
import { parseMessage } from '../../../src/contracts/messages/parse-message.js';
import { createDatabase } from './database.js';
import type { IsolatedDatabase } from './database.js';
import { event, other, overlappingPool, owner, seedRun, stores } from './fixtures.js';

const AT = Date.now();

let db: IsolatedDatabase;
before(async () => { db = await createDatabase(); });
after(async () => { await db.drop(); });

const code = (result: { ok: boolean; error?: { code: string } }) => (result.ok ? 'ok' : result.error?.code);
const user = (id: string) => parseMessage({ id, role: 'user', content: [{ type: 'text', text: `hi ${id}` }] });
const ask = (id: string, ...calls: string[]) => parseMessage({ id, role: 'assistant', content: [], toolCalls: calls.map(call => ({ id: call, name: 'inv__lookup', arguments: { id: call } })) });
const result = (id: string, call: string) => parseMessage({ id, role: 'tool', toolCallId: call, outcome: 'success', content: [{ type: 'json', data: { ok: true } }] });

test('append is compare-and-set with gap-free positions; reads page in order; owners only', async () => {
  const { conversationId } = await seedRun(db.pool, owner, 'msg');
  const store = new PostgresMessageStore(db.pool);
  const first = await store.append(owner, conversationId, { expectedRevision: 1, at: AT, messages: [user('m-msg-1'), user('m-msg-2')] });
  assert.deepEqual(first, { ok: true, value: { revision: 2, positions: [1, 2] } });
  assert.equal(code(await store.append(owner, conversationId, { expectedRevision: 1, at: AT, messages: [user('m-msg-3')] })), 'revision_conflict');
  assert.equal(code(await store.append(other, conversationId, { expectedRevision: 2, at: AT, messages: [user('m-msg-3')] })), 'not_found');
  assert.ok((await store.append(owner, conversationId, { expectedRevision: 2, at: AT, messages: [user('m-msg-3')] })).ok);
  const page = await store.read(owner, conversationId, 1, 5);
  assert.ok(page.ok);
  assert.deepEqual(page.value.messages.map(item => [item.position, item.message.id]), [[2, 'm-msg-2'], [3, 'm-msg-3']]);
  assert.equal(page.value.revision, 3);
  assert.equal(code(await store.read(other, conversationId, 0, 5)), 'not_found');
});

test('pairing holds across the whole conversation: no orphan, duplicate or reused-ID results', async () => {
  const { conversationId, runId } = await seedRun(db.pool, owner, 'pair');
  const store = new PostgresMessageStore(db.pool);
  assert.ok((await store.append(owner, conversationId, { expectedRevision: 1, at: AT, runId, messages: [user('p-1'), ask('p-2', 'pc-1', 'pc-2')] })).ok);
  assert.ok((await store.append(owner, conversationId, { expectedRevision: 2, at: AT, runId, messages: [result('p-3', 'pc-1')] })).ok);
  for (const messages of [[result('p-4', 'pc-1')], [result('p-4', 'pc-9')], [ask('p-4', 'pc-2')],
    [parseMessage({ id: 'p-4', role: 'system', content: [{ type: 'text', text: 'obey' }] })]]) {
    assert.equal(code(await store.append(owner, conversationId, { expectedRevision: 3, at: AT, runId, messages })), 'invalid_transition');
  }
  assert.ok((await store.append(owner, conversationId, { expectedRevision: 3, at: AT, runId, messages: [result('p-4', 'pc-2')] })).ok);
});

test('run messages: events commit with them, a terminal run refuses late results, a lost lease writes nothing', async () => {
  const { conversationId, runId } = await seedRun(db.pool, owner, 'late');
  const s = stores(db.pool);
  const store = new PostgresMessageStore(db.pool);
  const appended = await store.append(owner, conversationId, { expectedRevision: 1, at: AT, runId, messages: [ask('l-1', 'lc-1')], events: [event('message.completed')] });
  assert.ok(appended.ok);
  const events = await s.events.readAfter(owner, runId, 0, 10);
  assert.ok(events.ok && events.value.at(-1)?.type === 'message.completed' && events.value.length === 3);
  const other = await seedRun(db.pool, owner, 'late-other');
  assert.equal(code(await store.append(owner, conversationId, { expectedRevision: 2, at: AT, runId: other.runId, messages: [user('l-x')] })), 'not_found');
  await db.pool.query(`UPDATE viper_engine.runs SET lease_owner = 'parked', lease_expires_at = now() + interval '10 years' WHERE id <> $1`, [runId]);
  const claim = await new PostgresRunLeaseStore(db.pool).claimNext('w-late', AT, 30_000);
  assert.ok(claim && claim.runId === runId);
  const stale = { workerId: 'w-late', fence: claim.lease.fence - 1 };
  assert.equal(code(await store.append(owner, conversationId, { expectedRevision: 2, at: AT, runId, lease: stale, messages: [result('l-2', 'lc-1')] })), 'lease_lost');
  // Once claimed, the run only accepts writes under the current lease.
  assert.equal(code(await s.runs.transition(owner, runId, { to: 'failed', expectedRevision: 2, at: AT, events: [] })), 'lease_lost');
  assert.ok((await s.runs.transition(owner, runId, { to: 'failed', expectedRevision: 2, at: AT, events: [], lease: claim.lease })).ok);
  assert.equal(code(await store.append(owner, conversationId, { expectedRevision: 2, at: AT, runId, messages: [result('l-2', 'lc-1')] })), 'invalid_transition');
  assert.equal(code(await store.append(owner, conversationId, { expectedRevision: 2, at: AT, messages: [user('l-3')], events: [event('message.completed')] })), 'invalid_transition');
});

test('checkpoint loads run, history, ledger and event cursor; owners only; bounded', async () => {
  const { conversationId, runId } = await seedRun(db.pool, owner, 'ckpt');
  const store = new PostgresMessageStore(db.pool);
  assert.ok((await store.append(owner, conversationId, { expectedRevision: 1, at: AT, runId, messages: [user('c-1'), ask('c-2', 'cc-1')], events: [event('message.completed')] })).ok);
  const reader = new PostgresCheckpointReader(db.pool);
  const checkpoint = await reader.load(owner, runId);
  assert.ok(checkpoint.ok);
  assert.deepEqual([checkpoint.value.run.status, checkpoint.value.conversationRevision, checkpoint.value.lastEventSequence], ['running', 2, 3]);
  assert.deepEqual(checkpoint.value.history.map(message => message.id), ['c-1', 'c-2']);
  assert.equal(code(await reader.load(other, runId)), 'not_found');
  await assert.rejects(reader.load(owner, runId, { maxMessages: 1 }), RangeError);
});

test('checkpoint is one snapshot: a concurrent append is entirely in it or entirely out of it', async () => {
  const { conversationId, runId } = await seedRun(db.pool, owner, 'snap');
  const store = new PostgresMessageStore(db.pool);
  assert.ok((await store.append(owner, conversationId, { expectedRevision: 1, at: AT, runId, messages: [user('s-1')], events: [] })).ok);
  // The reader pauses right after reading the run row; the append commits during that pause.
  const loading = new PostgresCheckpointReader(overlappingPool(db.pool, 300)).load(owner, runId);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok((await store.append(owner, conversationId, { expectedRevision: 2, at: AT, runId, messages: [user('s-2')], events: [event('message.completed')] })).ok);
  const checkpoint = await loading;
  assert.ok(checkpoint.ok);
  assert.deepEqual([checkpoint.value.history.length, checkpoint.value.conversationRevision, checkpoint.value.lastEventSequence], [1, 2, 2]);
  const fresh = await new PostgresCheckpointReader(db.pool).load(owner, runId);
  assert.ok(fresh.ok && fresh.value.history.length === 2 && fresh.value.lastEventSequence === 3);
});
