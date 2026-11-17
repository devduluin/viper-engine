import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabase } from './database.js';
import { driver, setupRun, clock } from './durable-fixtures.js';
import { callsOf, decided, finalText } from '../../unit/runtime/harness.js';
import { DurableRunDriver } from '../../../src/application/durable/driver.js';
import { PostgresMessageStore } from '../../../src/adapters/persistence/postgres/message-store.js';
import { parseMessage } from '../../../src/contracts/messages/parse-message.js';
import { owner } from './fixtures.js';
import type { DurableDriverDependencies } from '../../../src/application/durable/types.js';
import type { RunId, ConversationId } from '../../../src/contracts/identity/ids.js';
import type { SqlPool } from '../../../src/adapters/persistence/postgres/sql-client.js';

async function wake(pool: SqlPool, deps: DurableDriverDependencies, run: { runId: RunId; conversationId: ConversationId }) {
  const cp = await deps.checkpoints.load(owner, run.runId); assert.ok(cp.ok);
  // Application input is a new user message; it cannot grant authority or reset saved limits.
  const messages = new PostgresMessageStore(pool);
  assert.ok((await messages.append(owner, run.conversationId, { expectedRevision: cp.value.conversationRevision, at: clock.now(),
    messages: [parseMessage({ id: 'resume-user', role: 'user', content: [{ type: 'text', text: 'Continue' }] })] })).ok);
  assert.ok((await deps.runs.wake(owner, run.runId, { expectedRevision: cp.value.run.revision, at: clock.now(), events: [] })).ok);
}

test('absolute duration survives input pause and is not renewed by a new driver', async () => {
  const db = await createDatabase();
  try {
    const run = await setupRun(db.pool, 'duration-restored');
    let now = Date.now();
    const h = await driver(db.pool, [decided({ kind: 'needs_input', question: 'Which?' })], { clock: { now: () => now } });
    const configure = h.deps.configure;
    const first = new DurableRunDriver({ ...h.deps, configure: async (...args) => ({ ...await configure(...args), limits: { maxDurationMs: 1000 } }) });
    const paused = await first.runOnce('duration-first');
    assert.ok(paused.kind === 'settled' && paused.status === 'waiting_for_input');
    await wake(db.pool, h.deps, run);
    now += 2000;
    const next = await driver(db.pool, [finalText('Must not request')], { clock: { now: () => now } });
    const result = await next.driver.runOnce('duration-next');
    assert.ok(result.kind === 'settled' && result.reason === 'deadline_exceeded');
    assert.equal(next.model.requests.length, 0);
  } finally { await db.drop(); }
});

test('repetition reservations survive pause even if a later host configuration offers larger limits', async () => {
  const db = await createDatabase();
  try {
    const run = await setupRun(db.pool, 'repetition-restored');
    const h = await driver(db.pool, [callsOf(['repeat-first', 'lookup', { id: 'a' }]), decided({ kind: 'needs_input', question: 'Continue?' })]);
    const configure = h.deps.configure;
    const first = new DurableRunDriver({ ...h.deps, configure: async (...args) => ({ ...await configure(...args), limits: { maxRepeatedToolCalls: 1 } }) });
    const paused = await first.runOnce('repetition-first');
    assert.ok(paused.kind === 'settled' && paused.status === 'waiting_for_input');
    await wake(db.pool, h.deps, run);
    const next = await driver(db.pool, [callsOf(['repeat-next', 'lookup', { id: 'a' }])]);
    const result = await next.driver.runOnce('repetition-next');
    assert.ok(result.kind === 'settled' && result.reason === 'repetition_limit');
    assert.equal(next.mcp.calls.length, 0);
  } finally { await db.drop(); }
});
