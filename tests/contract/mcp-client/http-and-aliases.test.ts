import assert from 'node:assert/strict';
import { test } from 'node:test';
import { namespaceTools, MODEL_ALIAS_PATTERN } from '../../../src/adapters/mcp/client/aliases.js';
import { toolDefinition } from '../../../src/adapters/mcp/client/catalog.js';
import { createTransport, parseHttpEndpoint } from '../../../src/adapters/mcp/client/transport.js';
import { parseId } from '../../../src/contracts/identity/ids.js';
import { testConnection } from '../../support/agent/setup.js';
import { httpFixture, owner } from '../../support/mcp/harness.js';

test('Streamable HTTP: initialize, paginated discovery, call and close', async () => {
  const mcp = await httpFixture();
  try {
    const capabilities = await mcp.gateway.getCapabilities(owner);
    assert.ok(capabilities.ok && capabilities.value.protocolVersion === '2025-11-25');
    const tools = await mcp.catalog.all();
    assert.equal(tools.length, 7);
    const add = tools.find(item => item.ref.name === 'add');
    assert.ok(add);
    const outcome = await mcp.gateway.callTool({
      ...owner, runId: parseId('run', 'r'), toolCallId: parseId('tool_call', 'h1'), tool: add.ref, arguments: { a: 2, b: 3 },
    });
    assert.deepEqual([outcome.status, outcome.structuredContent], ['success', { sum: 5 }]);
  } finally {
    await mcp.stop();
  }
  assert.equal(mcp.session.closed, true);
});

test('HTTP endpoints require https except loopback, and never embed credentials', () => {
  assert.equal(parseHttpEndpoint('https://mcp.example.com/mcp').hostname, 'mcp.example.com');
  assert.equal(parseHttpEndpoint('http://127.0.0.1:9000/mcp').port, '9000');
  assert.throws(() => parseHttpEndpoint('http://mcp.example.com/mcp'), /https/);
  assert.throws(() => parseHttpEndpoint('https://user:secret@mcp.example.com/mcp'), /credentials/);
  assert.throws(() => parseHttpEndpoint('file:///etc/passwd'), /https/);
  assert.throws(() => createTransport({ kind: 'stdio', command: '  ' }), /command/);
});

const connection = testConnection();
const definition = (name: string, extra: Record<string, unknown> = {}) => toolDefinition({
  name, inputSchema: { type: 'object' }, ...extra,
} as never, connection);

test('definition versions change with anything model-visible and nothing else', () => {
  const base = definition('lookup', { description: 'Get' });
  assert.equal(definition('lookup', { description: 'Get' }).ref.definitionVersion, base.ref.definitionVersion);
  assert.equal(definition('lookup', { description: 'Get', _meta: { x: 1 }, icons: [] }).ref.definitionVersion, base.ref.definitionVersion);
  for (const extra of [{ description: 'Get v2' }, { description: 'Get', annotations: { destructiveHint: true } },
    { description: 'Get', inputSchema: { type: 'object', required: ['id'] } }, { description: 'Get', title: 'T' }]) {
    assert.notEqual(definition('lookup', extra).ref.definitionVersion, base.ref.definitionVersion);
  }
  assert.throws(() => definition('bad', { inputSchema: { type: 'string' } }), /object schema/);
  assert.throws(() => definition(' '), /without a name/);
});

test('aliases are provider-safe, namespaced, stable and collision-free', () => {
  const tools = ['lookup', 'weird.name/v2', 'weird_name_v2', 'x'.repeat(80), 'y'.repeat(80)].map(name => definition(name));
  const aliased = namespaceTools('inv', tools);
  assert.equal(aliased[0]?.alias, 'inv__lookup');
  assert.ok(aliased.every(item => MODEL_ALIAS_PATTERN.test(item.alias)));
  assert.equal(new Set(aliased.map(item => item.alias)).size, tools.length);
  assert.equal(aliased[2]?.alias, 'inv__weird_name_v2');
  assert.match(aliased[1]?.alias ?? '', /^inv__weird_name_v2_[0-9a-f]{8}$/);
  assert.deepEqual(namespaceTools('inv', tools).map(item => item.alias), aliased.map(item => item.alias));
  const changed = namespaceTools('inv', [definition('weird.name/v2', { description: 'new' })]);
  assert.equal(changed[0]?.alias, aliased[1]?.alias);
  assert.equal(aliased[1]?.definition.ref.name, 'weird.name/v2');
  for (const prefix of ['', 'Inv', '1x', 'a_b', 'x'.repeat(17)]) assert.throws(() => namespaceTools(prefix, tools), /prefix/);
});
