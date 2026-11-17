import assert from 'node:assert/strict';
import { test } from 'node:test';
import { headlessFixture } from '../../support/client/headless-fixture.js';
import { historicalRun, enginePolicy, saved } from './context-fixtures.js';
import { anthropic, done, toolTurn, engine } from './engine-fixtures.js';
import { assertMessageHistory } from '../../../src/contracts/messages/history.js';
import { parseContextCheckpoint } from '../../../src/contracts/context/parse-checkpoint.js';
import { assertValid } from '../../contract/api/validate.js';

test('actual model SDK/MCP uses compressed context; HTTP exposes bounded statistics and canonical history remains complete', async () => {
  const f = await headlessFixture([toolTurn('lookup_item', { id: 'a' }), done], { context: enginePolicy });
  try {
    const run = await historicalRun(f.db.pool, f.client); f.host.start();
    let final = await f.client.run(run.runId);
    for await (const update of f.client.watch(run.runId)) if (update.kind === 'snapshot') final = update.snapshot;
    assert.equal(final.status, 'completed'); assert.equal(f.api.bodies.length, 2); assert.deepEqual(f.effects.calls, ['lookup_item']);
    assert.ok(final.context !== undefined && final.context.omittedMessages > 0);
    assert.ok(final.context.inputBytes <= enginePolicy.maxInputBytes); assert.ok(final.context.afterTokens < final.context.beforeTokens);
    assertValid('RunSnapshot', final);
    assert.ok(JSON.stringify(f.api.bodies[0]?.['messages']).includes('historical_excerpts_v1'));
    const persisted = await saved(f.db.pool, run.runId);
    assert.deepEqual(persisted.checkpoint.history.slice(0, run.before.length), run.before);
    assertMessageHistory(persisted.checkpoint.history, { allowPendingToolCalls: false });
    const publicHistory = await f.client.conversation(run.conversationId);
    assert.ok(!publicHistory.messages.some(message => String(message.id).startsWith('context-')));
    assert.equal(Object.hasOwn(final.context, 'excerpt'), false); assert.equal(Object.hasOwn(final.context, 'sourceDigest'), false);
    const restored = parseContextCheckpoint(persisted.checkpoint.execution?.state['contextCheckpoint']);
    assert.equal(restored.report.afterTokens, final.context.afterTokens);
  } finally { await f.close(); }
});

test('approval survives compressed-context engine restart with exact binding and the original context ceiling', async () => {
  const f = await headlessFixture([]); const firstModel = anthropic([toolTurn('record_write', { count: 5 })]);
  const first = engine(f.db.pool, f.connectionId, firstModel.model, { context: enginePolicy });
  const nextModel = anthropic([done]); const next = engine(f.db.pool, f.connectionId, nextModel.model, { context: { ...enginePolicy, maxInputBytes: 200000 } });
  try {
    const run = await historicalRun(f.db.pool, f.client); const paused = await first.runOnce('context-propose');
    assert.ok(paused.kind === 'settled' && paused.status === 'waiting_for_approval'); await first.close();
    const before = await saved(f.db.pool, run.runId); assert.ok(before.state.contextCheckpoint?.coveredMessages);
    const view = await f.client.run(run.runId); const approval = view.pendingApprovals?.[0]; assert.ok(approval);
    assert.deepEqual(approval.arguments, { count: 5 }); assert.equal(f.effects.writes(), 0);
    await f.client.decideApproval(approval.approvalId, { expectedRevision: approval.revision, proposal: approval.proposal, decision: 'accept' });
    const result = await next.runOnce('context-approved'); assert.ok(result.kind === 'settled' && result.status === 'completed');
    assert.equal(f.effects.writes(), 1); assert.equal(nextModel.api.bodies.length, 1);
    const after = await saved(f.db.pool, run.runId); assert.equal(after.state.contextBudget?.maxInputBytes, enginePolicy.maxInputBytes);
    assert.equal(after.state.contextCheckpoint?.preserveFromMessageId, before.state.contextCheckpoint?.preserveFromMessageId);
    assert.equal(after.checkpoint.toolCalls[0]?.attempts, 1); assert.equal(after.checkpoint.approvals[0]?.status, 'consumed');
    assert.deepEqual(after.checkpoint.history.slice(0, run.before.length), run.before);
  } finally { await first.close(); await next.close(); await f.close(); }
});

test('oversized active context fails with public BUDGET_EXCEEDED before model audit or MCP dispatch', async () => {
  const f = await headlessFixture([done], { context: { ...enginePolicy, maxInputBytes: 4000 } });
  try {
    const conversation = await f.client.createConversation();
    const run = await f.client.startRun(conversation.conversationId, { input: { content: [{ type: 'text', text: 'Required task '.repeat(1500) }] } }, 'too-large');
    f.host.start(); let final = await f.client.run(run.runId);
    for await (const update of f.client.watch(run.runId)) if (update.kind === 'snapshot') final = update.snapshot;
    assert.equal(final.status, 'failed'); assert.equal(f.api.bodies.length, 0); assert.equal(f.effects.calls.length, 0);
    assert.equal(final.usage?.modelCalls, 0); assert.equal(final.context, undefined);
    const events = []; for await (const item of f.client.events(run.runId)) events.push(item.event);
    assert.ok(events.some(event => event.type === 'run.failed' && JSON.stringify(event.payload).includes('BUDGET_EXCEEDED')));
  } finally { await f.close(); }
});

test('corrupt summary checkpoint blocks an accepted write before dispatch, while explicit cancel still cleans up', async () => {
  const f = await headlessFixture([]); const first = engine(f.db.pool, f.connectionId, anthropic([toolTurn('record_write', { count: 5 })]).model, { context: enginePolicy });
  const nextModel = anthropic([done]); const next = engine(f.db.pool, f.connectionId, nextModel.model, { context: enginePolicy });
  try {
    const run = await historicalRun(f.db.pool, f.client); await first.runOnce('context-corrupt-propose'); await first.close();
    const view = await f.client.run(run.runId); const approval = view.pendingApprovals?.[0]; assert.ok(approval);
    await f.client.decideApproval(approval.approvalId, { expectedRevision: approval.revision, proposal: approval.proposal, decision: 'accept' });
    await f.db.pool.query(`UPDATE viper_engine.runtime_checkpoints SET state = jsonb_set(state, '{contextCheckpoint,excerpt}', to_jsonb('forged'::text)) WHERE run_id = $1`, [run.runId]);
    await assert.rejects(next.runOnce('context-corrupt-block'), /excerpt changed/);
    assert.equal(f.effects.writes(), 0); assert.equal(nextModel.api.bodies.length, 0);
    await f.client.cancel(run.runId); const result = await next.runOnce('context-corrupt-cancel');
    assert.ok(result.kind === 'settled' && result.status === 'cancelled'); assert.equal(f.effects.writes(), 0);
  } finally { await first.close(); await next.close(); await f.close(); }
});
