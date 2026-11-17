import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startHttpServer } from '../../support/mcp/harness.js';
import { connection, owner, pool, record, MemoryDirectory, ScriptedCredentials } from '../../support/mcp/pool-fixtures.js';
import { parseId } from '../../../src/contracts/identity/ids.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';

test('HTTP session 404 retires the cached connection and a later acquire initializes afresh without replaying the call', async () => {
  const calls: string[] = []; const server = await startHttpServer({ fixture: { onCall: name => calls.push(name) } });
  const credentials = new ScriptedCredentials({ ok: true, credential: { kind: 'none' } });
  const subject = pool(new MemoryDirectory(record()), credentials, () => ({ kind: 'streamable_http', url: server.url }));
  try {
    const first = await subject.acquire(owner, connection.id); assert.ok(first.ok);
    const tool = (await first.connection.catalog.all()).find(item => item.ref.name === 'add'); assert.ok(tool);
    server.expireSessions();
    const rejected = await first.connection.gateway.callTool({ scope: owner, connection, runId: parseId('run', 'r'),
      toolCallId: parseId('tool_call', 'expired'), tool: tool.ref, arguments: { a: 1, b: 2 } });
    assert.ok(rejected.status === 'error' && rejected.error.code === 'connection_unavailable');
    assert.equal(first.connection.session.closed, true); assert.deepEqual(calls, []);
    const next = await subject.acquire(owner, connection.id); assert.ok(next.ok && next.connection !== first.connection);
    assert.deepEqual(credentials.calls, ['resolve', 'resolve']);
    const current = (await next.connection.catalog.all()).find(item => item.ref.name === 'add'); assert.ok(current);
    const result = await next.connection.gateway.callTool({ scope: owner, connection, runId: parseId('run', 'r'),
      toolCallId: parseId('tool_call', 'new-explicit-call'), tool: current.ref, arguments: { a: 2, b: 3 } });
    assert.equal(result.status, 'success'); assert.deepEqual(calls, ['add']);
  } finally { await subject.closeAll(); await server.stop(); }
});

test('resource -32002 maps to not_found without retiring a healthy session or exposing diagnostics', async () => {
  const server = await startHttpServer({ fixture: { missingResource: true } });
  const subject = pool(new MemoryDirectory(record()), new ScriptedCredentials({ ok: true, credential: { kind: 'none' } }),
    () => ({ kind: 'streamable_http', url: server.url }));
  try {
    const first = await subject.acquire(owner, connection.id); assert.ok(first.ok);
    const result = await first.connection.gateway.readResource({ scope: owner, connection, uri: 'fixture://policy' });
    assert.ok(!result.ok && result.error.code === 'not_found'); assert.ok(!JSON.stringify(result).includes('PRIVATE'));
    assert.equal(first.connection.session.closed, false);
    const next = await subject.acquire(owner, connection.id); assert.ok(next.ok && next.connection === first.connection);
  } finally { await subject.closeAll(); await server.stop(); }
});

test('resource-specific error number from tools/call does not fabricate a not-found refusal or replay', async () => {
  let calls = 0;
  const server = await startHttpServer({ fixture: { handlers: { add: () => { calls++; throw new McpError(-32002, 'PRIVATE ambiguous tool error'); } } } });
  const subject = pool(new MemoryDirectory(record()), new ScriptedCredentials({ ok: true, credential: { kind: 'none' } }),
    () => ({ kind: 'streamable_http', url: server.url }));
  try {
    const first = await subject.acquire(owner, connection.id); assert.ok(first.ok);
    const tool = (await first.connection.catalog.all()).find(item => item.ref.name === 'add'); assert.ok(tool);
    const result = await first.connection.gateway.callTool({ scope: owner, connection, runId: parseId('run', 'r'),
      toolCallId: parseId('tool_call', 'ambiguous-tool'), tool: tool.ref, arguments: { a: 1, b: 2 } });
    assert.equal(result.status, 'unknown'); assert.equal(calls, 1); assert.equal(first.connection.session.closed, false);
    assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  } finally { await subject.closeAll(); await server.stop(); }
});
