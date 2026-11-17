import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { parseId } from '../../../src/contracts/identity/ids.js';
import type { McpToolDefinition } from '../../../src/contracts/mcp/catalog.js';
import { testConnection, testScope } from '../../support/agent/setup.js';
import { isAlive, owner, stdioFixture } from '../../support/mcp/harness.js';
import type { StdioFixture } from '../../support/mcp/harness.js';

let mcp: StdioFixture;
before(async () => { mcp = await stdioFixture({ requestTimeoutMs: 1_500 }); });
after(async () => { await mcp.close(); });

const runId = parseId('run', 'run-mcp');
let counter = 0;
function call(tool: McpToolDefinition, args: Record<string, unknown> = {}, extra = {}) {
  counter += 1;
  return mcp.gateway.callTool({ ...owner, runId, toolCallId: parseId('tool_call', `c${counter}`), tool: tool.ref, arguments: args as never }, extra);
}
async function tool(name: string): Promise<McpToolDefinition> {
  const found = (await mcp.catalog.all()).find(item => item.ref.name === name);
  assert.ok(found, name);
  return found;
}
async function serverCalls(): Promise<string[]> {
  const outcome = await call(await tool('call_log'));
  assert.equal(outcome.status, 'success');
  return (outcome.structuredContent?.['calls'] as string[]).filter(name => name !== 'call_log');
}

test('initialize negotiates the pinned protocol and advertises capabilities', async () => {
  const capabilities = await mcp.gateway.getCapabilities(owner);
  assert.ok(capabilities.ok);
  assert.equal(capabilities.value.protocolVersion, '2025-11-25');
  assert.deepEqual(capabilities.value.tools, { listChanged: true });
  assert.ok(capabilities.value.resources && capabilities.value.prompts);
});

test('discovery paginates the whole catalog with stable definition versions', async () => {
  const first = await mcp.gateway.listTools(owner);
  assert.ok(first.ok && first.value.items.length === 2 && first.value.nextCursor === '2');
  const all = await mcp.catalog.all();
  assert.deepEqual(all.map(item => item.ref.name), ['lookup_item', 'add', 'hang', 'crash', 'grow', 'call_log', 'weird.name/v2']);
  assert.ok(all.every(item => /^[0-9a-f]{64}$/.test(item.ref.definitionVersion) && item.ref.connectionId === owner.connection.id));
  mcp.catalog.invalidate();
  assert.deepEqual((await mcp.catalog.all()).map(item => item.ref), all.map(item => item.ref));
  assert.deepEqual(all[0]?.annotations, { readOnlyHint: true });
});

test('success, isError and server-refused arguments are distinct and never unknown', async () => {
  const lookup = await tool('lookup_item');
  const ok = await call(lookup, { id: 'item-1' });
  assert.deepEqual([ok.status, ok.structuredContent], ['success', { id: 'item-1', stock: 5 }]);
  const missing = await call(lookup, { id: 'missing' });
  assert.ok(missing.status === 'error' && missing.error.code === 'not_found');
  const refused = await call(lookup, {});
  assert.ok(refused.status === 'error' && refused.error.code === 'invalid_value');
  assert.doesNotMatch(JSON.stringify(refused), /id is required/);
});

test('unknown definitions, foreign owners and invalid requests are not dispatched', async () => {
  const before = await serverCalls();
  const lookup = await tool('lookup_item');
  const stale = await call({ ...lookup, ref: { ...lookup.ref, definitionVersion: 'old' } }, { id: 'item-1' });
  assert.ok(stale.status === 'error' && stale.error.code === 'not_found');
  const foreign = await mcp.gateway.callTool({
    scope: testScope('intruder'), connection: testConnection(), runId, toolCallId: parseId('tool_call', 'x1'),
    tool: lookup.ref, arguments: { id: 'item-1' },
  });
  assert.ok(foreign.status === 'error' && foreign.error.code === 'permission');
  const aborted = new AbortController();
  aborted.abort();
  const cancelled = await call(lookup, { id: 'item-1' }, { signal: aborted.signal });
  assert.ok(cancelled.status === 'error' && cancelled.error.code === 'cancelled');
  assert.deepEqual((await serverCalls()).slice(before.length), []);
});

test('timeout and abort after dispatch are unknown, not failed', async () => {
  const hang = await tool('hang');
  const timedOut = await call(hang);
  assert.ok(timedOut.status === 'unknown' && timedOut.error.code === 'timeout');
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 100);
  const aborted = await call(hang, {}, { signal: controller.signal });
  assert.ok(aborted.status === 'unknown' && aborted.error.code === 'cancelled');
});

test('tools/list_changed invalidates the catalog; the old definition version is refused', async () => {
  const oldLookup = await tool('lookup_item');
  assert.equal((await call(await tool('grow'))).status, 'success');
  let names: string[] = [];
  for (let attempt = 0; attempt < 50 && !names.includes('extra'); attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 20));
    names = (await mcp.catalog.all()).map(item => item.ref.name);
  }
  assert.ok(names.includes('extra'));
  const newLookup = await tool('lookup_item');
  assert.notEqual(newLookup.ref.definitionVersion, oldLookup.ref.definitionVersion);
  const stale = await call(oldLookup, { id: 'item-1' });
  assert.ok(stale.status === 'error' && stale.error.code === 'not_found');
  assert.equal((await call(newLookup, { id: 'item-1' })).status, 'success');
});

test('server crash mid-call is unknown, closes the session and invalidates the catalog', async () => {
  const crashing = await stdioFixture();
  const crash = (await crashing.catalog.all()).find(item => item.ref.name === 'crash');
  assert.ok(crash);
  let invalidated = 0;
  crashing.session.onInvalidate(() => { invalidated += 1; });
  const outcome = await crashing.gateway.callTool({ ...owner, runId, toolCallId: parseId('tool_call', 'crash-1'), tool: crash.ref, arguments: {} });
  assert.equal(outcome.status, 'unknown');
  assert.equal(crashing.session.closed, true);
  assert.ok(invalidated >= 1);
  const after = await crashing.gateway.callTool({ ...owner, runId, toolCallId: parseId('tool_call', 'crash-2'), tool: crash.ref, arguments: {} });
  assert.ok(after.status === 'error' && after.error.code === 'connection_unavailable');
  const listing = await crashing.gateway.listTools(owner);
  assert.ok(!listing.ok && listing.error.code === 'connection_unavailable');
  await crashing.close();
});

test('closing the connection terminates the server subprocess', async () => {
  const fixture = await stdioFixture();
  const pid = fixture.transport.pid;
  assert.ok(pid !== null && isAlive(pid));
  await fixture.close();
  for (let attempt = 0; attempt < 50 && isAlive(pid); attempt += 1) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(isAlive(pid), false);
  assert.equal(fixture.session.closed, true);
});

test('resources and prompts are read through the session; a tools-only server reports unsupported', async () => {
  const resources = await mcp.gateway.listResources(owner);
  assert.deepEqual(resources, { ok: true, value: { items: [{ uri: 'fixture://policy', name: 'Fixture policy', mimeType: 'text/plain' }] } });
  const read = await mcp.gateway.readResource({ ...owner, uri: 'fixture://policy' });
  assert.ok(read.ok && 'text' in read.value[0]! && read.value[0].text.includes('reserve'));
  const prompt = await mcp.gateway.getPrompt({ ...owner, name: 'summarize_item', arguments: { id: 'item-1' } });
  assert.ok(prompt.ok);
  assert.deepEqual(prompt.value.messages[0]?.content, [{ type: 'text', text: 'Summarize item-1' }]);
  // Not advertised: refused locally as not_found (the fixture server would answer invalid_value).
  const secret = await mcp.gateway.readResource({ ...owner, uri: 'file:///etc/passwd' });
  assert.ok(!secret.ok && secret.error.code === 'not_found');
  const unknownPrompt = await mcp.gateway.getPrompt({ ...owner, name: 'system_override' });
  assert.ok(!unknownPrompt.ok && unknownPrompt.error.code === 'not_found');
  const toolsOnly = await stdioFixture({ toolsOnly: true });
  try {
    const unsupported = await toolsOnly.gateway.listResources(owner);
    assert.ok(!unsupported.ok && unsupported.error.code === 'unsupported');
    assert.ok((await toolsOnly.gateway.listTools(owner)).ok);
  } finally {
    await toolsOnly.close();
  }
});
