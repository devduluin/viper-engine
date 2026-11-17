import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { parseId } from '../../../src/contracts/identity/ids.js';
import { startHttpServer } from '../../support/mcp/harness.js';
import { bearer, connection, intruder, MemoryDirectory, owner, pool, record, ScriptedCredentials } from '../../support/mcp/pool-fixtures.js';

test('the owner gets a cached authorized session; another scope never reaches the server', async () => {
  const server = await startHttpServer({ token: () => 'good' });
  const subject = pool(new MemoryDirectory(record()), new ScriptedCredentials(bearer('good')), () => ({ kind: 'streamable_http', url: server.url }));
  try {
    const first = await subject.acquire(owner, connection.id);
    assert.ok(first.ok);
    const second = await subject.acquire(owner, connection.id);
    assert.ok(second.ok && second.connection === first.connection);
    const tools = await first.connection.catalog.all();
    assert.ok(tools.length > 0);
    const before = server.requests();
    assert.deepEqual(await subject.acquire(intruder, connection.id), { ok: false, code: 'not_found' });
    assert.deepEqual(await subject.acquire(owner, parseId('mcp_connection', 'other')), { ok: false, code: 'not_found' });
    assert.equal(server.requests(), before);
  } finally {
    await subject.closeAll();
    await server.stop();
  }
});

test('HTTP 401 triggers exactly one refresh; a second 401 marks the connection for re-authorization', async () => {
  const server = await startHttpServer({ token: () => 'fresh' });
  try {
    const recovering = new ScriptedCredentials(bearer('stale'), bearer('fresh'));
    const ok = pool(new MemoryDirectory(record()), recovering, () => ({ kind: 'streamable_http', url: server.url }));
    assert.ok((await ok.acquire(owner, connection.id)).ok);
    assert.deepEqual(recovering.calls, ['resolve', 'refresh:stale']);
    await ok.closeAll();
    const directory = new MemoryDirectory(record());
    const failing = new ScriptedCredentials(bearer('stale'), bearer('also-stale'));
    const subject = pool(directory, failing, () => ({ kind: 'streamable_http', url: server.url }));
    assert.deepEqual(await subject.acquire(owner, connection.id), { ok: false, code: 'authentication_required' });
    assert.deepEqual(failing.calls, ['resolve', 'refresh:stale']);
    assert.equal(directory.record.authState, 'authentication_required');
    const requests = server.requests();
    assert.deepEqual(await subject.acquire(owner, connection.id), { ok: false, code: 'authentication_required' });
    assert.equal(server.requests(), requests);
  } finally {
    await server.stop();
  }
});

test('mid-session expiry returns authentication_required, retires the session and refreshes only on a later acquire', async () => {
  let token = 'v1';
  const server = await startHttpServer({ token: () => token });
  const credentials = new ScriptedCredentials(bearer('v1'), bearer('v2'));
  const subject = pool(new MemoryDirectory(record()), credentials, () => ({ kind: 'streamable_http', url: server.url }));
  try {
    const acquired = await subject.acquire(owner, connection.id);
    assert.ok(acquired.ok);
    const add = (await acquired.connection.catalog.all()).find(tool => tool.ref.name === 'add');
    assert.ok(add);
    token = 'v2';
    const outcome = await acquired.connection.gateway.callTool({
      scope: owner, connection, runId: parseId('run', 'r'), toolCallId: parseId('tool_call', 'c1'), tool: add.ref, arguments: { a: 1, b: 2 },
    });
    assert.ok(outcome.status === 'error' && outcome.error.code === 'authentication_required');
    assert.equal(acquired.connection.session.closed, true);
    const refreshed = await subject.acquire(owner, connection.id);
    assert.ok(refreshed.ok && refreshed.connection !== acquired.connection);
    assert.deepEqual(credentials.calls, ['resolve', 'resolve', 'refresh:v1']);
    const nextTool = (await refreshed.connection.catalog.all()).find(tool => tool.ref.name === 'add');
    assert.ok(nextTool);
    const next = await refreshed.connection.gateway.callTool({ scope: owner, connection,
      runId: parseId('run', 'r'), toolCallId: parseId('tool_call', 'c2'), tool: nextTool.ref, arguments: { a: 1, b: 2 } });
    assert.equal(next.status, 'success');
  } finally {
    await subject.closeAll();
    await server.stop();
  }
});

test('revocation closes the live session; revoked, disabled or credential-less connections are refused', async () => {
  const server = await startHttpServer();
  const directory = new MemoryDirectory(record());
  const subject = pool(directory, new ScriptedCredentials({ ok: true, credential: { kind: 'none' } }), () => ({ kind: 'streamable_http', url: server.url }));
  try {
    const acquired = await subject.acquire(owner, connection.id);
    assert.ok(acquired.ok);
    assert.equal(await subject.revoke(intruder, connection.id, 1), false);
    assert.equal(await subject.revoke(owner, connection.id, 1), true);
    assert.equal(acquired.connection.session.closed, true);
    const listing = await acquired.connection.gateway.listTools({ scope: owner, connection });
    assert.ok(!listing.ok && listing.error.code === 'connection_unavailable');
    assert.deepEqual(await subject.acquire(owner, connection.id), { ok: false, code: 'revoked' });
    const disabled = pool(new MemoryDirectory(record({ server: { ...record().server, enabled: false } })), new ScriptedCredentials(bearer('x')), () => ({ kind: 'streamable_http', url: server.url }));
    assert.deepEqual(await disabled.acquire(owner, connection.id), { ok: false, code: 'connection_unavailable' });
    const revokedCredential = pool(new MemoryDirectory(record()), new ScriptedCredentials({ ok: false, code: 'revoked' }), () => ({ kind: 'streamable_http', url: server.url }));
    assert.deepEqual(await revokedCredential.acquire(owner, connection.id), { ok: false, code: 'revoked' });
  } finally {
    await subject.closeAll();
    await server.stop();
  }
});

test('stdio credentials reach only the subprocess environment, without the parent environment', async () => {
  process.env['VIPER_SECRET_LEAK'] = 'parent-only';
  const args = ['--import', 'tsx', path.resolve('tests/support/mcp/stdio-entry.ts'), '--env-probe'];
  const subject = pool(new MemoryDirectory(record({ server: { ...record().server, transport: 'stdio' } })),
    new ScriptedCredentials({ ok: true, credential: { kind: 'environment', variables: { FIXTURE_TOKEN: 'per-user' } } }),
    () => ({ kind: 'stdio', command: process.execPath, args }));
  try {
    const acquired = await subject.acquire(owner, connection.id);
    assert.ok(acquired.ok);
    const probe = (await acquired.connection.catalog.all()).find(tool => tool.ref.name === 'env_probe');
    assert.ok(probe);
    const outcome = await acquired.connection.gateway.callTool({
      scope: owner, connection, runId: parseId('run', 'r'), toolCallId: parseId('tool_call', 'p1'), tool: probe.ref, arguments: {},
    });
    assert.deepEqual(outcome.structuredContent, { token: 'per-user', path: null });
  } finally {
    delete process.env['VIPER_SECRET_LEAK'];
    await subject.closeAll();
  }
});
