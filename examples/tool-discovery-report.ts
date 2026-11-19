import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { ToolDiscovery } from '../src/agent/discovery/controller.js';
import type { RuntimeTool } from '../src/agent/execution/tool-catalog.js';
import { schemaTokens } from '../src/agent/discovery/catalog.js';
import { TOOL_SEARCH_NAME } from '../src/contracts/discovery/state.js';
import { parseId } from '../src/contracts/identity/ids.js';
import { runtimeTool } from '../tests/unit/runtime/harness.js';
import { testContext } from '../tests/support/agent/setup.js';

// Synthetic structural measurement: no live model, MCP, DB, environment, billing or quality score.
function measure(size: number) {
  const tools: RuntimeTool[] = Array.from({ length: size - 1 }, (_, index) => {
    const tool = runtimeTool(`workin__operation_${index}`);
    return { ...tool, definition: { ...tool.definition,
      description: 'Read an employee record from the synthetic HR fixture.',
      inputSchema: { type: 'object', properties: { employeeId: { type: 'string', description: 'Employee identifier' } },
        required: ['employeeId'], additionalProperties: false } } };
  });
  tools.push(runtimeTool('margin__journal'));
  const scope = testContext().scope; const runId = parseId('run', `catalog-${size}`);
  const eager = new ToolDiscovery(tools, scope, runId, { mode: 'off' });
  const lazy = new ToolDiscovery(tools, scope, runId, { mode: 'auto' });
  const stats = (schemas: unknown) => ({ bytes: Buffer.byteLength(JSON.stringify(schemas)), approximateTokens: schemaTokens(schemas) });
  const initial = { count: lazy.index.modelTools.length, ...stats(lazy.index.modelTools) };
  assert.deepEqual(lazy.index.modelTools.map(tool => tool.name), [TOOL_SEARCH_NAME]);
  assert.deepEqual(lazy.search({ query: 'journal', source: 'margin' }).loaded, ['margin__journal']);
  assert.equal(lazy.index.modelTools.length, 2);
  assert.equal(lazy.index.find('workin__operation_0'), undefined);
  return { authorizedTools: size, eager: { count: eager.index.modelTools.length, ...stats(eager.index.modelTools) },
    initial, afterSearch: { count: lazy.index.modelTools.length, ...stats(lazy.index.modelTools) } };
}
const report = { version: 1, fixture: 'Synthetic HR distractors and one exact accounting alias',
  settings: { mode: 'auto', query: 'journal', source: 'margin' }, sizes: [400, 1000, 3000].map(measure),
  liveQuality: 'NOT_MEASURED', billing: 'NOT_MEASURED', latency: 'NOT_MEASURED',
  limitation: 'Approximate serialized schema tokens only; model selection is scripted in other tests. Lexical multilingual recall is not benchmarked.' };
mkdirSync('artifacts/discovery', { recursive: true });
writeFileSync('artifacts/discovery/catalog-scaling.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
