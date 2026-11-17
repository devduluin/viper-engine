import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseId } from '../../../src/contracts/identity/ids.js';
import { PooledMcpGateway } from '../../../src/adapters/mcp/client/pooled-gateway.js';
import { discoverRuntimeTools, EngineSetupError } from '../../../src/bootstrap/mcp-tools.js';
import { owner, intruder, connection, MemoryDirectory, ScriptedCredentials, record, pool } from '../../support/mcp/pool-fixtures.js';
import { startHttpServer } from '../../support/mcp/harness.js';

const clock = { now: () => Date.now() };
const discovery = { clock, timeoutMs: 15000, maxConnections: 4, maxPages: 10, maxTools: 100 };
const none = () => new ScriptedCredentials({ ok: true, credential: { kind: 'none' } });

test('pooled discovery creates stable aliases and routes tool/resources/prompts with owner checks', async () => {
  const server = await startHttpServer(); const directory = new MemoryDirectory(record());
  const connections = pool(directory, none(), () => ({ kind: 'streamable_http', url: server.url }));
  const gateway = new PooledMcpGateway(connections, clock, 10000);
  try {
    const bindings = [{ id: connection.id }];
    const tools = await discoverRuntimeTools(owner, bindings, directory, gateway, discovery);
    const again = await discoverRuntimeTools(owner, bindings, directory, gateway, discovery);
    assert.equal(tools.length, 7);
    assert.deepEqual(tools.map(tool => tool.alias), again.map(tool => tool.alias));
    const add = tools.find(tool => tool.definition.ref.name === 'add'); assert.ok(add);
    const outcome = await gateway.callTool({ ...add.context, runId: parseId('run', 'r'), toolCallId: parseId('tool_call', 'c'),
      tool: add.definition.ref, arguments: { a: 2, b: 3 } });
    assert.equal(outcome.status, 'success');
    const context = { scope: owner, connection };
    assert.ok((await gateway.listResources(context)).ok);
    assert.ok((await gateway.readResource({ ...context, uri: 'fixture://policy' })).ok);
    assert.ok((await gateway.listPrompts(context)).ok);
    assert.ok((await gateway.getPrompt({ ...context, name: 'summarize_item', arguments: { id: 'a' } })).ok);
    const before = server.requests();
    const foreign = await gateway.listTools({ ...context, scope: intruder });
    assert.ok(!foreign.ok && foreign.error.code === 'not_found');
    assert.equal(server.requests(), before);
    await assert.rejects(discoverRuntimeTools(intruder, bindings, directory, gateway, discovery),
      error => error instanceof EngineSetupError && error.code === 'not_found');
  } finally { await connections.closeAll(); await server.stop(); }
});

test('ambiguous namespaces, catalog/page limits and expired operations fail closed', async () => {
  const server = await startHttpServer(); const directory = new MemoryDirectory(record());
  const connections = pool(directory, none(), () => ({ kind: 'streamable_http', url: server.url }));
  const gateway = new PooledMcpGateway(connections, clock, 10000);
  const binding = { id: connection.id, namespace: 'inv' };
  try {
    for (const bindings of [[binding, binding], [{ ...binding, namespace: 'INVALID' }]]) {
      await assert.rejects(discoverRuntimeTools(owner, bindings, directory, gateway, discovery), EngineSetupError);
    }
    assert.equal(server.requests(), 0);
    const expired = await gateway.listTools({ scope: owner, connection }, { deadlineAt: 0 });
    assert.ok(!expired.ok && expired.error.code === 'timeout');
    assert.equal(server.requests(), 0);
    for (const limits of [{ maxPages: 1 }, { maxTools: 1 }, { maxConnections: 0 }]) {
      await assert.rejects(discoverRuntimeTools(owner, [binding], directory, gateway, { ...discovery, ...limits }), EngineSetupError);
    }
  } finally { await connections.closeAll(); await server.stop(); }
});
