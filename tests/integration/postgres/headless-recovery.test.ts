import assert from 'node:assert/strict';
import { test } from 'node:test';
import { headlessFixture } from '../../support/client/headless-fixture.js';
import { cutFirstStream } from '../../support/client/cut-stream.js';
import { runHeadlessTask } from '../../../examples/headless.js';
import { done, toolTurn } from './engine-fixtures.js';
import { ScriptedModel } from '../../support/agent/scripted-model.js';
import { callsOf, finalText } from '../../unit/runtime/harness.js';

const input = { input: { content: [{ type: 'text' as const, text: 'Perform task' }] } };

test('actual socket reconnect resumes after applied cursor without repeating approved MCP effect', async () => {
  const network = cutFirstStream();
  const f = await headlessFixture([toolTurn('lookup_item', { id: 'a' }, 'read'), toolTurn('record_write', { count: 5 }, 'write'), done], { fetch: network.fetch });
  const sequences: number[] = [];
  try {
    const result = await runHeadlessTask(f.client, { input, idempotencyKey: 'headless-reconnect', onUpdate: async update => {
      if (update.kind === 'snapshot' && update.snapshot.status === 'queued') f.host.start();
      if (update.kind === 'event') sequences.push(update.event.sequence);
    }, decide: async approval => { assert.equal(approval.proposal.tool.name, 'record_write'); return 'accept'; } });
    assert.equal(result.status, 'completed'); assert.ok(network.streams() >= 2); assert.equal(f.effects.writes(), 1);
    assert.equal(f.api.bodies.length, 3); assert.equal(new Set(sequences).size, sequences.length);
    for (let i = 1; i < sequences.length; i++) assert.equal(sequences[i], sequences[i - 1]! + 1);
  } finally { await f.close(); }
});

test('mixed measured/estimated usage keeps each incomplete aggregate null through the public snapshot', async () => {
  const gateway = new ScriptedModel([
    { result: { ...callsOf(['read', 'inv__lookup_item', { id: 'a' }]), usage: { source: 'provider', inputTokens: 8, outputTokens: 3, totalTokens: 11 } } },
    { result: { ...finalText('Finished'), usage: { source: 'estimate', inputTokens: 2, outputTokens: null, totalTokens: null } } },
  ], { now: Date.now });
  const f = await headlessFixture([], { model: { provider: 'fixture', model: 'fixture', gateway } });
  try {
    const conversation = await f.client.createConversation();
    const accepted = await f.client.startRun(conversation.conversationId, input, 'mixed-usage');
    assert.deepEqual((await f.client.run(accepted.runId)).usage, { modelCalls: 0, source: 'unavailable', inputTokens: null, outputTokens: null, totalTokens: null });
    f.host.start(); let usage;
    for await (const update of f.client.watch(accepted.runId)) if (update.kind === 'snapshot') usage = update.snapshot.usage;
    assert.deepEqual(usage, { modelCalls: 2, source: 'mixed', inputTokens: 10, outputTokens: null, totalTokens: null });
  } finally { await f.close(); }
});

test('provider failure is observable as failed with unknown usage, never a successful empty result', async () => {
  const f = await headlessFixture([{ status: 401, errorType: 'authentication_error' }]); const events: string[] = [];
  try {
    const result = await runHeadlessTask(f.client, { input, idempotencyKey: 'headless-failed', onUpdate: async update => {
      if (update.kind === 'snapshot' && update.snapshot.status === 'queued') f.host.start();
      if (update.kind === 'event') events.push(update.event.type);
    } });
    assert.equal(result.status, 'failed'); assert.ok(events.includes('run.failed'));
    assert.deepEqual(result.usage, { modelCalls: 1, source: 'unavailable', inputTokens: null, outputTokens: null, totalTokens: null });
    assert.equal(result.finalMessage, undefined); assert.ok(!JSON.stringify(result).includes('sensitive provider text'));
  } finally { await f.close(); }
});

test('write timeout after the MCP effect exposes unknown and resuming observation never repeats it', async () => {
  const f = await headlessFixture([toolTurn('record_write', { count: 5 }), done], { requestTimeoutMs: 100, writeDelayMs: 500 });
  const outcomes: unknown[] = [];
  try {
    const result = await runHeadlessTask(f.client, { input, idempotencyKey: 'headless-unknown', onUpdate: async update => {
      if (update.kind === 'snapshot' && update.snapshot.status === 'queued') f.host.start();
      if (update.kind === 'event' && update.event.type === 'tool.failed') outcomes.push(update.event.payload['outcome']);
    }, decide: async () => 'accept' });
    assert.equal(result.status, 'partial'); assert.deepEqual(outcomes, ['unknown']); assert.equal(f.effects.writes(), 1);
    const history = await f.client.conversation(result.conversationId);
    assert.ok(history.messages.some(message => message.role === 'tool' && message.outcome === 'unknown'));
    const attempts = f.api.bodies.length; assert.equal(attempts, 2);
    for await (const update of f.client.watch(result.runId)) assert.equal(update.kind, 'snapshot');
    assert.equal(f.effects.writes(), 1); assert.equal(f.api.bodies.length, attempts);
  } finally { await f.close(); }
});
