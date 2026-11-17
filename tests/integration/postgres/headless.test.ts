import assert from 'node:assert/strict';
import { test } from 'node:test';
import { headlessFixture } from '../../support/client/headless-fixture.js';
import { runHeadlessTask } from '../../../examples/headless.js';
import { done, toolTurn } from './engine-fixtures.js';
import { ScriptedModel } from '../../support/agent/scripted-model.js';
import { decided, finalText } from '../../unit/runtime/harness.js';
import type { ClientUpdate } from '../../../src/contracts/client/ports.js';
import { createEngineClient } from '../../../src/bootstrap/client.js';
import { failure } from '../../support/client/fixtures.js';

const input = { input: { content: [{ type: 'text' as const, text: 'Read stock, calculate and record the approved count' }] } };

test('headless real HTTP/SSE read chain and exact approved write exposes progress, history and provider usage', async () => {
  const f = await headlessFixture([toolTurn('lookup_item', { id: 'a' }, 'read'), toolTurn('add', { a: 2, b: 3 }, 'calculate'),
    toolTurn('record_write', { count: 5 }, 'write'), done]); const updates: ClientUpdate[] = []; let decisions = 0;
  try {
    const connection = await f.client.createConnection('server-headless'); assert.equal(connection.connectionId, f.connectionId);
    assert.equal((await f.client.connections()).items.length, 1);
    const final = await runHeadlessTask(f.client, { input, idempotencyKey: 'headless-write', onUpdate: async update => {
      updates.push(update); if (update.kind === 'snapshot' && update.snapshot.status === 'queued') f.host.start();
    }, decide: async approval => {
      assert.equal(f.effects.writes(), 0); assert.equal(approval.proposal.tool.name, 'record_write');
      assert.deepEqual(approval.arguments, { count: 5 }); decisions++; return 'accept';
    } });
    assert.equal(final.status, 'completed'); assert.equal(f.effects.writes(), 1); assert.equal(decisions, 1);
    assert.deepEqual(f.effects.calls, ['lookup_item', 'add', 'record_write']);
    assert.deepEqual(final.usage, { modelCalls: 4, source: 'provider', inputTokens: 40, outputTokens: 20, totalTokens: 60 });
    const events = updates.filter(update => update.kind === 'event').map(update => update.event);
    assert.ok(events.some(event => event.type === 'approval.required')); assert.equal(events.filter(event => event.type === 'tool.completed').length, 3);
    const history = await f.client.conversation(final.conversationId); assert.equal(history.messages.filter(message => message.role === 'tool').length, 3);
    assert.ok(!JSON.stringify(history).includes('PRIVATE_MCP_META'));
    const foreign = createEngineClient({ baseUrl: f.baseUrl, getToken: async () => 'other' });
    await assert.rejects(foreign.run(final.runId), failure('NOT_FOUND'));
    const revoked = await f.client.disconnect(connection.connectionId, connection.revision); assert.equal(revoked.authState, 'revoked');
  } finally { await f.close(); }
});

test('headless clarification submits the exact current revision and one stable input identity', async () => {
  const gateway = new ScriptedModel([{ result: decided({ kind: 'needs_input', question: 'Which item?' }) }, { result: finalText('Item a confirmed') }], { now: Date.now });
  const f = await headlessFixture([], { model: { provider: 'fixture', model: 'fixture', gateway } }); let answers = 0;
  try {
    const final = await runHeadlessTask(f.client, { input, idempotencyKey: 'headless-input', onUpdate: async update => {
      if (update.kind === 'snapshot' && update.snapshot.status === 'queued') f.host.start();
    }, answer: async snapshot => { assert.equal(snapshot.inputQuestion, 'Which item?'); answers++;
      return { inputId: 'answer-once', input: { content: [{ type: 'text', text: 'a' }] } }; } });
    assert.equal(final.status, 'completed'); assert.equal(answers, 1); assert.match(JSON.stringify(final.finalMessage), /Item a confirmed/);
    assert.deepEqual(final.usage, { modelCalls: 2, source: 'unavailable', inputTokens: null, outputTokens: null, totalTokens: null });
    assert.equal((await f.db.pool.query('SELECT count(*)::int AS n FROM viper_engine.input_receipts')).rows[0].n, 1);
  } finally { await f.close(); }
});

test('headless example returns a paused proposal when no trusted approval handler is supplied', async () => {
  const f = await headlessFixture([toolTurn('record_write', { count: 5 })]);
  try {
    const paused = await runHeadlessTask(f.client, { input, idempotencyKey: 'headless-no-grant', onUpdate: async update => {
      if (update.kind === 'snapshot' && update.snapshot.status === 'queued') f.host.start();
    } });
    assert.equal(paused.status, 'waiting_for_approval'); assert.equal(paused.pendingApprovals?.length, 1); assert.equal(f.effects.writes(), 0);
    await f.client.cancel(paused.runId);
    for await (const update of f.client.watch(paused.runId)) {
      if (update.kind === 'snapshot' && update.snapshot.status === 'cancelled') assert.equal(update.snapshot.status, 'cancelled');
    }
    assert.equal(f.effects.writes(), 0); assert.equal(f.api.bodies.length, 1);
  } finally { await f.close(); }
});

test('headless tool error remains observable and run partial is not reported as success', async () => {
  const f = await headlessFixture([toolTurn('lookup_item', { id: 'a' }, 'ok'), toolTurn('lookup_item', { id: 'missing' }, 'error'), done]); const events: string[] = [];
  try {
    const result = await runHeadlessTask(f.client, { input, idempotencyKey: 'headless-error', onUpdate: async update => {
      if (update.kind === 'snapshot' && update.snapshot.status === 'queued') f.host.start();
      if (update.kind === 'event') events.push(update.event.type);
    } });
    assert.equal(result.status, 'partial'); assert.ok(events.includes('tool.failed')); assert.ok(events.includes('run.partial'));
    const history = await f.client.conversation(result.conversationId);
    assert.ok(history.messages.some(message => message.role === 'tool' && message.outcome === 'error'));
  } finally { await f.close(); }
});
