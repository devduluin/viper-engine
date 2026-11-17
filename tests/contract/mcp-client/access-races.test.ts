import assert from 'node:assert/strict';
import test from 'node:test';
import { parseId } from '../../../src/contracts/identity/ids.js';
import { McpConnectionPool } from '../../../src/adapters/mcp/client/connection-pool.js';
import { startHttpServer } from '../../support/mcp/harness.js';
import { httpFixture } from '../../support/mcp/harness.js';
import { connection, MemoryDirectory, owner, pool, record, ScriptedCredentials } from '../../support/mcp/pool-fixtures.js';

test('revocation during credential resolution prevents the pending open from publishing or contacting the server', async () => {
  const server = await startHttpServer();
  const directory = new MemoryDirectory(record());
  let resume!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const waiting = new Promise<void>(resolve => { resume = resolve; });
  const subject = pool(directory, { resolve: async () => {
    entered(); await waiting; return { ok: true, credential: { kind: 'none' } };
  }, refresh: async () => ({ ok: false, code: 'authentication_required' }) }, () => ({ kind: 'streamable_http', url: server.url }));
  try {
    const pending = subject.acquire(owner, connection.id);
    await started;
    assert.equal(await subject.revoke(owner, connection.id, Date.now()), true);
    resume();
    assert.equal((await pending).ok, false);
    assert.equal(server.requests(), 0);
    assert.deepEqual(await subject.acquire(owner, connection.id), { ok: false, code: 'revoked' });
  } finally { resume(); await subject.closeAll(); await server.stop(); }
});

test('already acquired gateways and catalogs recheck durable directory revocation without reacquire', async () => {
  const server = await startHttpServer();
  const directory = new MemoryDirectory(record());
  const subject = pool(directory, new ScriptedCredentials({ ok: true, credential: { kind: 'none' } }),
    () => ({ kind: 'streamable_http', url: server.url }));
  try {
    const result = await subject.acquire(owner, connection.id);
    assert.ok(result.ok);
    const add = (await result.connection.catalog.all()).find(tool => tool.ref.name === 'add');
    assert.ok(add);
    await directory.revoke(owner, connection.id);
    const before = server.requests();
    const called = await result.connection.gateway.callTool({ scope: owner, connection,
      runId: parseId('run', 'r'), toolCallId: parseId('tool_call', 'c'), tool: add.ref, arguments: { a: 1, b: 2 } });
    assert.ok(called.status === 'error' && called.error.code === 'permission');
    await assert.rejects(result.connection.catalog.all());
    assert.equal(result.connection.session.closed, true);
    // Closing may send DELETE; the tool itself must not be sent.
    assert.ok(server.requests() <= before + 1);
  } finally { await subject.closeAll(); await server.stop(); }
});

test('closeAll invalidates pending credentials and prevents late publication', async () => {
  let resume!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const waiting = new Promise<void>(resolve => { resume = resolve; });
  const subject = pool(new MemoryDirectory(record()), { resolve: async () => {
    entered(); await waiting; return { ok: true, credential: { kind: 'none' } };
  }, refresh: async () => ({ ok: false, code: 'authentication_required' }) }, () => { throw new Error('Must not connect'); });
  const pending = subject.acquire(owner, connection.id);
  await started;
  const closing = subject.closeAll();
  resume();
  assert.equal((await pending).ok, false);
  await closing;
  assert.deepEqual(await subject.acquire(owner, connection.id), { ok: false, code: 'connection_unavailable' });
});

test('a hung credential port is bounded by the total connect timeout', async () => {
  const subject = new McpConnectionPool({ directory: new MemoryDirectory(record()),
    credentials: { resolve: () => new Promise(() => {}), refresh: () => new Promise(() => {}) },
    resolveEndpoint: () => { throw new Error('Must not connect'); }, clock: { now: () => Date.now() },
    connectTimeoutMs: 30, requestTimeoutMs: 1000 });
  assert.deepEqual(await subject.acquire(owner, connection.id), { ok: false, code: 'connection_unavailable' });
  await subject.closeAll();
});

test('endpoint revision changes replace cached sessions instead of using the earlier credential binding', async () => {
  const first = await startHttpServer();
  const second = await startHttpServer();
  let url = first.url;
  const directory = new MemoryDirectory(record());
  const subject = pool(directory, new ScriptedCredentials({ ok: true, credential: { kind: 'none' } }),
    () => ({ kind: 'streamable_http', url }));
  try {
    const old = await subject.acquire(owner, connection.id);
    assert.ok(old.ok);
    directory.record = { ...record(), revision: 2, server: { ...record().server, endpointRef: 'replacement' } };
    url = second.url;
    const next = await subject.acquire(owner, connection.id);
    assert.ok(next.ok && next.connection !== old.connection);
    assert.equal(old.connection.session.closed, true);
    assert.ok(second.requests() > 0);
  } finally { await subject.closeAll(); await first.stop(); await second.stop(); }
});

test('selected prompt name and arguments are immutable across awaited advertisement checks', async () => {
  const fixture = await httpFixture();
  try {
    const request = { scope: owner, connection, name: 'summarize_item', arguments: { id: 'original' } };
    const original = fixture.session.client.listPrompts.bind(fixture.session.client);
    fixture.session.client.listPrompts = async (...args) => {
      const result = await original(...args);
      request.name = 'unadvertised'; request.arguments.id = 'mutated';
      return result;
    };
    const result = await fixture.gateway.getPrompt(request);
    assert.ok(result.ok);
    assert.deepEqual(result.value.messages, [{ role: 'user', content: [{ type: 'text', text: 'Summarize original' }] }]);
  } finally { await fixture.stop(); }
});

test('resource/prompt admission rechecks revocation after the advertised listing resolves', async () => {
  const server = await startHttpServer();
  const directory = new MemoryDirectory(record());
  const subject = pool(directory, new ScriptedCredentials({ ok: true, credential: { kind: 'none' } }),
    () => ({ kind: 'streamable_http', url: server.url }));
  try {
    const acquired = await subject.acquire(owner, connection.id);
    assert.ok(acquired.ok);
    const client = acquired.connection.session.client;
    const original = client.listPrompts.bind(client);
    client.listPrompts = async (...args) => {
      const result = await original(...args);
      await directory.revoke(owner, connection.id);
      return result;
    };
    let sends = 0;
    const originalGet = client.getPrompt.bind(client);
    client.getPrompt = (...args) => { sends += 1; return originalGet(...args); };
    const result = await acquired.connection.gateway.getPrompt({ scope: owner, connection, name: 'summarize_item', arguments: { id: 'a' } });
    assert.ok(!result.ok && result.error.code === 'permission');
    assert.equal(sends, 0);
  } finally { await subject.closeAll(); await server.stop(); }
});
