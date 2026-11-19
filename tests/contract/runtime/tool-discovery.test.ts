import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FakeAnthropic } from '../../support/anthropic/fake-api.js';
import { FakeOpenAI } from '../../support/openai/fake-api.js';
import { harness, run, runtimeTool, StubMcp, success } from '../../unit/runtime/harness.js';
import { TOOL_SEARCH_NAME } from '../../../src/contracts/discovery/state.js';

test('Anthropic SDK receives only search then loaded schemas with paired private tool results', async () => {
  const fake = new FakeAnthropic([
    { blocks: [{ type: 'tool_use', id: 'search', name: TOOL_SEARCH_NAME, input: { query: 'lookup' } }] },
    { blocks: [{ type: 'tool_use', id: 'actual', name: 'workin__lookup', input: { id: 'a' } }] },
    { blocks: [{ type: 'text', text: 'Done' }] },
  ]);
  const mcp = new StubMcp(() => success({ found: true }));
  const h = harness([], mcp, { input: { tools: [runtimeTool('workin__lookup'), runtimeTool('margin__journal')], toolDiscovery: { mode: 'on' } },
    deps: { model: fake.gateway() } });
  assert.equal((await run(h)).status, 'completed'); assert.equal(mcp.calls.length, 1);
  assert.deepEqual((fake.bodies[0]?.['tools'] as { name: string }[]).map(tool => tool.name), [TOOL_SEARCH_NAME]);
  assert.deepEqual((fake.bodies[1]?.['tools'] as { name: string }[]).map(tool => tool.name), [TOOL_SEARCH_NAME, 'workin__lookup']);
  assert.match(JSON.stringify(fake.bodies[1]?.['messages']), /tool_result/);
});

test('OpenAI Chat SDK uses normal typed functions after local discovery without Responses migration', async () => {
  const fake = new FakeOpenAI([
    { toolCalls: [{ id: 'search', name: TOOL_SEARCH_NAME, argumentFragments: ['{"query":"lookup"}'] }] },
    { toolCalls: [{ id: 'actual', name: 'workin__lookup', argumentFragments: ['{"id":"a"}'] }] },
    { text: ['Done'] },
  ]);
  const mcp = new StubMcp(() => success({ found: true }));
  const h = harness([], mcp, { input: { tools: [runtimeTool('workin__lookup'), runtimeTool('margin__journal')], toolDiscovery: { mode: 'on' } },
    deps: { model: fake.gateway() } });
  assert.equal((await run(h)).status, 'completed'); assert.equal(mcp.calls.length, 1);
  const names = (i: number) => (fake.bodies[i]?.['tools'] as { function: { name: string } }[]).map(tool => tool.function.name);
  assert.deepEqual(names(0), [TOOL_SEARCH_NAME]); assert.deepEqual(names(1), [TOOL_SEARCH_NAME, 'workin__lookup']);
  assert.match(JSON.stringify(fake.bodies[1]?.['messages']), /tool_call_id/);
});
