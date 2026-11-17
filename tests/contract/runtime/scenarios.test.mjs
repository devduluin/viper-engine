import assert from 'node:assert/strict';
import test from 'node:test';
import Ajv from 'ajv';
import { loadFixtures } from '../../../evals/lib/fixtures.mjs';
import { FakeMcp } from '../../../evals/support/fake-mcp.mjs';
import { runAgentLoop } from '../../../src/agent/runtime/run-loop.ts';
import { parseId } from '../../../src/contracts/identity/ids.ts';
import { assertMessageHistory } from '../../../src/contracts/messages/history.ts';
import { parseMessage } from '../../../src/contracts/messages/parse-message.ts';
import { parseModelDecision } from '../../../src/contracts/models/decision.ts';
import { FakeMcpGateway } from '../../support/agent/fake-mcp.ts';
import { TestClock, TestIds } from '../../support/agent/identity.ts';
import { ScriptedModel } from '../../support/agent/scripted-model.ts';
import { testConnection, testScope } from '../../support/agent/setup.ts';

const root = process.cwd();
const { catalog, scenarios } = loadFixtures(root);
const unavailable = { source: 'unavailable', inputTokens: null, outputTokens: null, totalTokens: null };
const ajv = new Ajv({ allErrors: true, strict: true });

// Real JSON Schema validation injected through the runtime port.
const validator = {
  validate(schema, args) {
    const check = ajv.compile(schema);
    if (check(args)) return { ok: true };
    const [first] = check.errors ?? [];
    return { ok: false, message: first?.message ?? 'invalid arguments' };
  },
};

// Test policy from server hints only: read-only tools execute, everything else needs approval.
const readOnly = new Set(catalog.tools.filter(tool => tool.annotations?.readOnlyHint === true).map(tool => tool.name));
const policy = { decide: tool => readOnly.has(tool.definition.ref.name) ? 'execute' : 'requires_approval' };

async function replay(scenario, limits) {
  const clock = new TestClock();
  const ids = new TestIds();
  const scope = testScope();
  const context = { scope, connection: testConnection() };
  const service = new FakeMcp(root, catalog);
  const mcp = new FakeMcpGateway(context, service, clock);
  const definitions = (await mcp.listTools(context)).value.items;
  const model = new ScriptedModel(scenario.modelResponses.map(decision => ({
    result: { ok: true, decision: parseModelDecision(decision), usage: unavailable },
  })), clock);
  const conversationId = parseId('conversation', 'conversation-a');
  const goal = parseMessage({ id: 'goal', role: 'user', content: [{ type: 'text', text: scenario.goal }] });
  const events = [];
  const result = await runAgentLoop({
    scope, conversationId, runId: parseId('run', 'run-a'), model: 'scripted-test', maxOutputTokens: 100,
    maxModelCalls: 6, history: { scope, conversationId, messages: [goal] },
    ...(limits === undefined ? {} : { limits }),
    tools: definitions.map(definition => ({ alias: definition.ref.name, definition, context })),
  }, { model, mcp, clock, ids, validator, policy, onEvent: event => { events.push(event); } });
  return { result, events, model, dispatched: service.calls.filter(call => call.method === 'tools/call'), goal };
}

const covered = ['VE-001', 'VE-002', 'VE-003', 'VE-004', 'VE-005', 'VE-008'];

for (const id of covered) {
  test(`${id}: runtime loop reaches the expected state with the expected MCP dispatches`, async () => {
    const scenario = scenarios.find(item => item.id === id);
    assert.ok(scenario);
    const { result, model, dispatched, goal } = await replay(scenario);
    assert.equal(result.status, scenario.expected.state);
    assert.deepEqual(dispatched.map(call => call.params.name), scenario.expected.toolNames);
    assert.equal(model.remaining, 0);
    const history = [goal, ...result.messages];
    assertMessageHistory(history, { allowPendingToolCalls: result.status === 'waiting_for_approval' });
    const repeated = await replay(scenario);
    assert.deepEqual(repeated.result, result);
    assert.deepEqual(repeated.events, (await replay(scenario)).events);
  });
}

test('VE-003: the second call is made after, and with, the first result evidence', async () => {
  const { result, model, dispatched } = await replay(scenarios.find(item => item.id === 'VE-003'));
  const evidence = model.requests[1].messages.at(-1);
  assert.equal(evidence.role, 'tool');
  assert.equal(evidence.toolCallId, 'c1');
  assert.deepEqual(evidence.content.at(-1), { type: 'json', data: { id: 'item-1', stock: 5 } });
  assert.equal(dispatched[1].params.arguments.a, 5);
  assert.equal(model.requests[2].messages.at(-1).content.at(-1).data.sum, 8);
  assert.deepEqual(result.toolCalls.map(call => [call.id, call.status]), [['c1', 'succeeded'], ['c2', 'succeeded']]);
});

test('VE-005: MCP isError is reported as a failed call and a failed run, not success', async () => {
  const { result } = await replay(scenarios.find(item => item.id === 'VE-005'));
  assert.deepEqual(result.toolCalls.map(call => [call.status, call.failureCode]), [['failed', 'not_found']]);
  const toolResult = result.messages.find(message => message.role === 'tool');
  assert.equal(toolResult.outcome, 'error');
});

test('VE-008: a write stays a held proposal; the fake service never sees tools/call', async () => {
  const { result, dispatched, events } = await replay(scenarios.find(item => item.id === 'VE-008'));
  assert.equal(dispatched.length, 0);
  assert.deepEqual(result.toolCalls.map(call => [call.name, call.status]), [['save_note', 'awaiting_approval']]);
  assert.equal(events.some(event => event.type === 'tool_call_dispatching'), false);
});

test('schema-invalid arguments are rejected by the injected validator before the fake service', async () => {
  const base = scenarios.find(item => item.id === 'VE-002');
  const scenario = { ...base, modelResponses: [
    { kind: 'tool_calls', calls: [{ id: 'c0', name: 'lookup_item', arguments: { id: '' } }] },
    ...base.modelResponses,
  ] };
  const { result, dispatched } = await replay(scenario);
  assert.deepEqual(result.toolCalls.map(call => [call.status, call.failureCode]), [['rejected', 'invalid_value'], ['succeeded', undefined]]);
  assert.deepEqual(dispatched.map(call => call.params.arguments), [{ id: 'item-1' }]);
  assert.equal(result.status, 'completed');
});

test('VE-009: repetition guard stops the second exact lookup before dispatch, with deterministic evidence', async () => {
  const scenario = scenarios.find(item => item.id === 'VE-009');
  assert.ok(scenario);
  const first = await replay(scenario, { maxRepeatedToolCalls: 1 });
  const second = await replay(scenario, { maxRepeatedToolCalls: 1 });
  assert.equal(first.result.status, scenario.expected.state);
  assert.equal(first.result.reason, 'repetition_limit');
  assert.deepEqual(first.dispatched.map(call => call.params.name), scenario.expected.toolNames);
  assert.equal(first.result.modelCalls, 2);
  assert.deepEqual(first.result, second.result);
  assert.deepEqual(first.events, second.events);
  assertMessageHistory([first.goal, ...first.result.messages], { allowPendingToolCalls: false });
});
