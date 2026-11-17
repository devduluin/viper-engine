import assert from 'node:assert/strict';
import test from 'node:test';
import Ajv from 'ajv';
import { loadFixtures } from '../../../evals/lib/fixtures.mjs';
import { FakeMcp } from '../../../evals/support/fake-mcp.mjs';
import { AgentRunSession } from '../../../src/application/runs/session.ts';
import { parseId } from '../../../src/contracts/identity/ids.ts';
import { assertMessageHistory } from '../../../src/contracts/messages/history.ts';
import { parseModelDecision } from '../../../src/contracts/models/decision.ts';
import { FakeMcpGateway } from '../../support/agent/fake-mcp.ts';
import { TestClock, TestIds } from '../../support/agent/identity.ts';
import { ScriptedModel } from '../../support/agent/scripted-model.ts';
import { testConnection, testScope } from '../../support/agent/setup.ts';

const root = process.cwd();
const { catalog, scenarios } = loadFixtures(root);
const usage = { source: 'unavailable', inputTokens: null, outputTokens: null, totalTokens: null };
const ajv = new Ajv({ strict: true });

async function setup(id, continuation) {
  const scenario = scenarios.find(item => item.id === id);
  assert.ok(scenario);
  const scope = testScope();
  const clock = new TestClock();
  const context = { scope, connection: testConnection() };
  const service = new FakeMcp(root, catalog);
  const mcp = new FakeMcpGateway(context, service, clock);
  const definitions = (await mcp.listTools(context)).value.items;
  const tools = definitions.map(definition => ({ alias: definition.ref.name, definition, context }));
  const model = new ScriptedModel([...scenario.modelResponses, ...continuation].map(decision => ({
    result: { ok: true, decision: parseModelDecision(decision), usage },
  })), clock);
  const conversationId = parseId('conversation', 'workflow-conversation');
  const user = { id: parseId('message', 'initial-user'), role: 'user', content: [{ type: 'text', text: scenario.goal }] };
  const session = await AgentRunSession.start({ scope, conversationId, runId: parseId('run', 'workflow-run'),
    model: 'scripted', maxModelCalls: 6, maxOutputTokens: 100, tools,
    history: { scope, conversationId, messages: [user] },
  }, {
    model, mcp, clock, ids: new TestIds(), refreshTools: async () => tools,
    validator: { validate: (schema, args) => ajv.compile(schema)(args) ? { ok: true } : { ok: false, message: 'Invalid arguments' } },
    policy: { decide: tool => tool.alias === 'save_note' ? 'requires_approval' : 'execute' },
  });
  return { session, scope, service, model, user };
}

const final = text => ({ kind: 'final', content: [{ type: 'text', text }] });
const lookup = id => ({ kind: 'tool_calls', calls: [{ id: 'lookup-call', name: 'lookup_item', arguments: { id } }] });

test('VE-004 continues after supplied item ID through real fake-MCP evidence to final', async () => {
  const { session, scope, service, user } = await setup('VE-004', [lookup('item-1'), final('Stock: 5')]);
  assert.equal(session.snapshot(scope).status, 'waiting_for_input');
  assert.equal(service.calls.filter(call => call.method === 'tools/call').length, 0);
  const result = await session.submitInput(scope, { inputId: 'input-a', expectedRevision: 1,
    content: [{ type: 'text', text: 'item-1' }] });
  assert.equal(result.status, 'completed');
  assert.equal(result.modelCalls, 3);
  assert.deepEqual(service.calls.filter(call => call.method === 'tools/call').map(call => call.params.arguments), [{ id: 'item-1' }]);
  assertMessageHistory([user, ...result.messages], { allowPendingToolCalls: false });
});

test('VE-008 consumes an exact approval once and continues without regenerating the write', async () => {
  const { session, scope, service, user } = await setup('VE-008', [final('Saved example note')]);
  const original = session.snapshot(scope);
  const approval = original.actions.find(action => action.kind === 'approval_required');
  assert.ok(approval);
  assert.deepEqual(approval.arguments, { text: 'example' });
  const accepted = await session.decideApproval(scope, { approvalId: approval.approvalId,
    expectedRevision: approval.revision, binding: approval.binding, decision: 'accept' });
  assert.equal(service.calls.filter(call => call.method === 'tools/call').length, 0);
  const result = await session.resume(scope, accepted.revision);
  assert.equal(result.status, 'completed');
  assert.equal(result.modelCalls, 2);
  assert.deepEqual(service.calls.filter(call => call.method === 'tools/call').map(call => call.params), [{ name: 'save_note', arguments: { text: 'example' } }]);
  assertMessageHistory([user, ...result.messages], { allowPendingToolCalls: false });
  await assert.rejects(session.resume(scope, result.revision), /invalid_state/);
  assert.equal(service.calls.filter(call => call.method === 'tools/call').length, 1);
});

test('MCP failure after clarification still determines failed outcome despite a fluent final', async () => {
  const { session, scope } = await setup('VE-004', [lookup('missing'), final('There is no matching item')]);
  const result = await session.submitInput(scope, { inputId: 'input-missing', expectedRevision: 1,
    content: [{ type: 'text', text: 'missing' }] });
  assert.deepEqual([result.status, result.reason], ['failed', 'tool_failures']);
  assert.equal(result.toolCalls[0].failureCode, 'not_found');
});
