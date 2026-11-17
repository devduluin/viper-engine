import assert from 'node:assert/strict';
import test from 'node:test';
import { parseId } from '../../../src/contracts/identity/ids.js';
import { indexTools } from '../../../src/agent/execution/tool-catalog.js';
import { testScope } from '../../support/agent/setup.js';
import { callsOf, harness, run, runtimeTool, StubMcp, success } from './harness.js';

test('runtime cannot execute or disclose a catalog belonging to another actor/app/tenant', async () => {
  for (const scope of [testScope('other'), testScope('actor-a', 'other'), testScope('actor-a', 'app-a', 'tenant')]) {
    const original = runtimeTool('lookup');
    const tool = { ...original, context: { ...original.context, scope } };
    const mcp = new StubMcp(() => success({ ok: true }));
    const h = harness([callsOf(['c1', 'lookup'])], mcp, { input: { tools: [tool] } });
    await assert.rejects(run(h), /Scope access denied/);
    assert.equal(h.model.requests.length, 0);
    assert.equal(mcp.calls.length, 0);
  }
});

test('indexed definition and connection are immutable snapshots of validated bindings', () => {
  const tool = runtimeTool('lookup');
  const mutable = { ...tool, context: { ...tool.context, connection: { ...tool.context.connection } },
    definition: { ...tool.definition, ref: { ...tool.definition.ref }, inputSchema: { type: 'object' } },
  };
  const index = indexTools([mutable], tool.context.scope);
  mutable.definition.ref.name = 'replaced';
  mutable.context.connection.id = parseId('mcp_connection', 'replaced');
  mutable.definition.inputSchema.type = 'string';
  assert.equal(index.find('lookup')?.definition.ref.name, 'lookup');
  assert.equal(index.find('lookup')?.context.connection.id, tool.context.connection.id);
  assert.deepEqual(index.find('lookup')?.definition.inputSchema, { type: 'object' });
  assert.equal(Object.isFrozen(index.find('lookup')?.definition.ref), true);
});
