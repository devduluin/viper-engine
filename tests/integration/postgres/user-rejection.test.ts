import assert from 'node:assert/strict';
import { test } from 'node:test';
import { headlessFixture } from '../../support/client/headless-fixture.js';
import { anthropic, done, toolTurn, engine } from './engine-fixtures.js';
import { driver } from './durable-fixtures.js';
import { callsOf, finalText } from '../../unit/runtime/harness.js';
import { saved } from './context-fixtures.js';
import { crashWorker } from '../../support/durable/process.js';
import { assertMessageHistory } from '../../../src/contracts/messages/history.js';
import type { ToolCallDecision } from '../../../src/agent/execution/plan-call.js';

async function start(f: Awaited<ReturnType<typeof headlessFixture>>) {
  const conversation = await f.client.createConversation();
  return f.client.startRun(conversation.conversationId, { input: { content: [{ type: 'text', text: 'Propose recording count 5' }] } }, 'decline-once');
}
async function reject(f: Awaited<ReturnType<typeof headlessFixture>>, runId: string) {
  const view = await f.client.run(runId); const approval = view.pendingApprovals?.[0]; assert.ok(approval);
  const response = await f.client.decideApproval(approval.approvalId, { expectedRevision: approval.revision, proposal: approval.proposal, decision: 'reject' });
  assert.equal(response.status, 'rejected');
}

test('HTTP reject survives engine restart and reaches the real model SDK as user-declined evidence without MCP dispatch', async () => {
  const f = await headlessFixture([]); const first = engine(f.db.pool, f.connectionId, anthropic([toolTurn('record_write', { count: 5 })]).model);
  const finalModel = anthropic([done]); const next = engine(f.db.pool, f.connectionId, finalModel.model);
  try {
    const run = await start(f); await first.runOnce('decline-propose'); await first.close(); await reject(f, run.runId);
    const result = await next.runOnce('decline-observe'); assert.ok(result.kind === 'settled' && result.status === 'completed');
    assert.equal(f.effects.writes(), 0); assert.equal(f.effects.calls.length, 0); assert.equal(finalModel.api.bodies.length, 1);
    const body = JSON.stringify(finalModel.api.bodies[0]?.['messages']); assert.match(body, /rejected_by_user/);
    assert.match(body, /user declined/); assert.ok(!body.includes('not permitted by policy'));
    const cp = await saved(f.db.pool, run.runId);
    assert.equal(cp.state.reports[0]?.failureCode, 'rejected_by_user'); assert.equal(cp.checkpoint.toolCalls[0]?.status, 'rejected');
    assert.equal(cp.checkpoint.toolCalls[0]?.attempts, 0); assert.equal(cp.checkpoint.approvals[0]?.status, 'rejected');
    const events = []; for await (const item of f.client.events(run.runId)) events.push(item.event);
    assert.equal(events.filter(event => event.type === 'tool.started').length, 0);
    assert.equal(events.filter(event => event.type === 'message.completed' && JSON.stringify(event.payload).includes('rejected_by_user')).length, 1);
  } finally { await first.close(); await next.close(); await f.close(); }
});

test('a later permissive host policy cannot revive a user-rejected call that originally required no approval', async () => {
  const f = await headlessFixture([]); let decision: ToolCallDecision = 'execute';
  const first = engine(f.db.pool, f.connectionId, anthropic([toolTurn('record_write', { count: 5 })]).model,
    { policy: { decide: () => decision }, onEvent: event => {
      if (event.type === 'message_appended' && event.message.role === 'assistant' && event.message.toolCalls !== undefined) decision = 'requires_approval';
    } });
  const finalModel = anthropic([done]); const next = engine(f.db.pool, f.connectionId, finalModel.model, { policy: { decide: () => 'execute' } });
  try {
    const run = await start(f); const paused = await first.runOnce('decline-policy-change');
    assert.ok(paused.kind === 'settled' && paused.status === 'waiting_for_approval'); await first.close();
    const before = await saved(f.db.pool, run.runId); assert.equal(before.checkpoint.toolCalls[0]?.requiresApproval, false);
    await reject(f, run.runId);
    const result = await next.runOnce('decline-permissive'); assert.ok(result.kind === 'settled' && result.status === 'completed');
    assert.equal(f.effects.writes(), 0); assert.equal(f.effects.calls.length, 0);
    const cp = await saved(f.db.pool, run.runId); assert.equal(cp.checkpoint.toolCalls[0]?.attempts, 0);
    assert.equal(cp.state.reports[0]?.failureCode, 'rejected_by_user');
    assert.match(JSON.stringify(finalModel.api.bodies[0]?.['messages']), /rejected_by_user/);
  } finally { await first.close(); await next.close(); await f.close(); }
});

test('OS-kill after rejection commit restores its host-only failure code without replay or duplicate result', async () => {
  const f = await headlessFixture([]);
  try {
    const run = await start(f); const first = await driver(f.db.pool, [callsOf(['declined', 'lookup'])], { policy: { decide: () => 'requires_approval' } });
    await first.driver.runOnce('decline-crash-propose'); await reject(f, run.runId);
    await crashWorker(f.db.name, 'declined', 'decline-committed', 'tests/support/durable/rejected-worker.ts');
    const before = await saved(f.db.pool, run.runId); assert.equal(before.state.reports[0]?.failureCode, 'rejected_by_user');
    assert.equal(before.checkpoint.toolCalls[0]?.attempts, 0); await f.db.pool.query('SELECT pg_sleep(1.1)');
    const next = await driver(f.db.pool, [finalText('User declined')], { policy: { decide: () => 'requires_approval' } });
    const result = await next.driver.runOnce('decline-after-kill'); assert.ok(result.kind === 'settled' && result.status === 'completed');
    assert.equal(next.mcp.calls.length, 0); assert.equal(next.model.requests.length, 1);
    assert.match(JSON.stringify(next.model.requests[0]?.messages), /rejected_by_user/);
    const after = await saved(f.db.pool, run.runId);
    assert.equal(after.checkpoint.history.filter(message => message.role === 'tool' && message.toolCallId === 'declined').length, 1);
    assertMessageHistory(after.checkpoint.history, { allowPendingToolCalls: false });
    assert.equal(after.state.reports[0]?.failureCode, 'rejected_by_user'); assert.equal(after.state.modelCalls, 2);
  } finally { await f.close(); }
});
