import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFixtures } from '../../../evals/lib/fixtures.mjs';
import { FakeMcp } from '../../../evals/support/fake-mcp.mjs';
import { assembleContext } from '../../../src/agent/context/assemble.ts';
import { parseModelDecision } from '../../../src/contracts/models/decision.ts';
import { parseMessage } from '../../../src/contracts/messages/parse-message.ts';
import { assertMessageHistory } from '../../../src/contracts/messages/history.ts';
import { ScriptedModel } from '../../support/agent/scripted-model.ts';
import { MemoryHistoryFixtures } from '../../support/agent/history.ts';
import { TestClock, TestIds } from '../../support/agent/identity.ts';
import { FakeMcpGateway } from '../../support/agent/fake-mcp.ts';
import { testConnection, testContext } from '../../support/agent/setup.ts';

const root = process.cwd();
const { catalog, scenarios } = loadFixtures(root);
const unavailable = { source: 'unavailable', inputTokens: null, outputTokens: null, totalTokens: null };

// Finite fixture replay, deliberately test-owned. P03-02 supplies the actual runtime coordinator.
async function replay(scenario) {
  const clock = new TestClock();
  const ids = new TestIds();
  const input = testContext();
  const store = new MemoryHistoryFixtures();
  const context = { scope: input.scope, connection: testConnection() };
  const service = new FakeMcp(root, catalog);
  const mcp = new FakeMcpGateway(context, service, clock);
  const definitions = (await mcp.listTools(context)).value.items;
  const tools = definitions.map(tool => ({ name: tool.ref.name, inputSchema: tool.inputSchema }));
  const model = new ScriptedModel(scenario.modelResponses.map(decision => ({
    result: { ok: true, decision: parseModelDecision(decision), usage: unavailable },
  })), clock);
  let history = store.seed(input.scope, input.conversationId, [parseMessage({
    id: ids.next('message'), role: 'user', content: [{ type: 'text', text: scenario.goal }],
  })]);
  const trace = [];
  for (const _frame of scenario.modelResponses) {
    const prepared = assembleContext({ ...input, tools, history,
      stepId: ids.next('step'), modelCallId: ids.next('model_call'),
    }, model.capabilities, clock.now());
    const result = await model.generate(prepared.request);
    assert.equal(result.ok, true);
    const decision = result.decision;
    trace.push({ kind: 'model', decision });
    const assistant = parseMessage({ id: ids.next('message'), role: 'assistant', content: decision.content,
      ...(decision.kind === 'tool_calls' ? { toolCalls: decision.calls } : {}),
    });
    history = store.append(input.scope, input.conversationId, history.revision, [assistant]);
    for (const call of decision.calls ?? []) {
      const tool = definitions.find(item => item.ref.name === call.name);
      assert.ok(tool);
      const outcome = await mcp.callTool({ ...context, runId: input.runId,
        toolCallId: call.id, tool: tool.ref, arguments: call.arguments,
      });
      trace.push({ kind: 'tool', call, outcome });
      const content = [...outcome.content,
        ...(outcome.structuredContent === undefined ? [] : [{ type: 'json', data: outcome.structuredContent }]),
      ];
      history = store.append(input.scope, input.conversationId, history.revision, [parseMessage({
        id: ids.next('message'), role: 'tool', toolCallId: call.id, outcome: outcome.status, content,
      })]);
    }
  }
  assert.equal(model.remaining, 0);
  assertMessageHistory(history.messages, { allowPendingToolCalls: false });
  return { trace, history, requests: model.requests, calls: service.calls };
}

for (const id of ['VE-001', 'VE-002', 'VE-003']) {
  test(`${id}: final/single-tool/chained context replay is deterministic and preserves evidence`, async () => {
    const scenario = scenarios.find(item => item.id === id);
    assert.ok(scenario);
    const result = await replay(scenario);
    const repeated = await replay(scenario);
    assert.deepEqual(result.trace, repeated.trace);
    assert.deepEqual(result.history.messages, repeated.history.messages);
    const dispatched = result.calls.filter(call => call.method === 'tools/call');
    assert.deepEqual(dispatched.map(call => call.params.name), scenario.expected.toolNames);
    assert.equal(result.requests.length, scenario.modelResponses.length);
    assert.deepEqual(result.history.messages.at(-1).content, scenario.modelResponses.at(-1).content);
    const results = result.history.messages.filter(message => message.role === 'tool');
    assert.deepEqual(results.map(message => message.toolCallId), result.trace.filter(event => event.kind === 'tool').map(event => event.call.id));
    if (id === 'VE-003') {
      const secondRequest = result.requests[1];
      const evidence = secondRequest.messages.at(-1);
      assert.equal(evidence.role, 'tool');
      assert.equal(evidence.toolCallId, 'c1');
      assert.deepEqual(evidence.content.at(-1), { type: 'json', data: { id: 'item-1', stock: 5 } });
      assert.equal(dispatched[1].params.arguments.a, evidence.content.at(-1).data.stock);
      assert.equal(result.requests[2].messages.at(-1).content.at(-1).data.sum, 8);
    }
  });
}
