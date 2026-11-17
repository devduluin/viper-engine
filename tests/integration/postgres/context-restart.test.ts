import assert from 'node:assert/strict';
import { test } from 'node:test';
import { headlessFixture } from '../../support/client/headless-fixture.js';
import { historicalRun, configure, saved } from './context-fixtures.js';
import { driver } from './durable-fixtures.js';
import { decided, finalText } from '../../unit/runtime/harness.js';
import { crashWorker } from '../../support/durable/process.js';
import { assertMessageHistory } from '../../../src/contracts/messages/history.js';

test('durable clarification restart retains original run task, new input and pinned context policy', async () => {
  const f = await headlessFixture([]);
  try {
    const run = await historicalRun(f.db.pool, f.client);
    const first = await driver(f.db.pool, [decided({ kind: 'needs_input', question: 'Which item?' })], { configure: configure() });
    const paused = await first.driver.runOnce('context-input-pause'); assert.ok(paused.kind === 'settled' && paused.status === 'waiting_for_input');
    const before = await saved(f.db.pool, run.runId); const view = await f.client.run(run.runId);
    await f.client.submitInput(run.runId, { inputId: 'context-answer', expectedRevision: view.revision,
      input: { content: [{ type: 'text', text: 'item-a' }] } });
    const next = await driver(f.db.pool, [finalText('Confirmed')], { configure: configure(200000) });
    const result = await next.driver.runOnce('context-input-resume'); assert.ok(result.kind === 'settled' && result.status === 'completed');
    const after = await saved(f.db.pool, run.runId); assert.equal(after.state.contextBudget?.maxInputBytes, 6000);
    assert.equal(after.state.contextCheckpoint?.preserveFromMessageId, before.state.contextCheckpoint?.preserveFromMessageId);
    assert.ok(next.model.requests[0]!.messages.some(message => message.id === before.state.contextCheckpoint?.preserveFromMessageId));
    assert.ok(JSON.stringify(next.model.requests[0]).includes('item-a'));
    assertMessageHistory(after.checkpoint.history, { allowPendingToolCalls: false });
  } finally { await f.close(); }
});

test('OS-kill after atomic context/model-start checkpoint resumes under its saved budget without losing canonical history', async () => {
  const f = await headlessFixture([]);
  try {
    const run = await historicalRun(f.db.pool, f.client);
    await crashWorker(f.db.name, 'context', 'context-committed', 'tests/support/context/crash-worker.ts');
    const before = await saved(f.db.pool, run.runId); assert.ok(before.state.modelPending && before.state.contextCheckpoint?.coveredMessages);
    await f.db.pool.query('SELECT pg_sleep(1.1)');
    const next = await driver(f.db.pool, [finalText('Recovered')], { configure: configure(200000) });
    const result = await next.driver.runOnce('context-after-kill'); assert.ok(result.kind === 'settled' && result.status === 'completed');
    const after = await saved(f.db.pool, run.runId);
    assert.equal(after.state.contextBudget?.maxInputBytes, 6000); assert.equal(after.state.modelCalls, 2);
    assert.deepEqual(after.checkpoint.history.slice(0, run.before.length), run.before);
    assert.equal(after.state.contextCheckpoint?.sourceDigest, before.state.contextCheckpoint?.sourceDigest);
    assert.ok(JSON.stringify(next.model.requests[0]).includes('historical_excerpts_v1'));
    assert.equal(next.mcp.calls.length, 0);
  } finally { await f.close(); }
});
