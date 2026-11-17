import assert from 'node:assert/strict';
import test from 'node:test';
import { parseId } from '../../../src/contracts/identity/ids.js';
import { SdkMcpGateway } from '../../../src/adapters/mcp/client/gateway.js';
import { TestClock } from '../../support/agent/identity.js';
import { testScope } from '../../support/agent/setup.js';
import { httpFixture, owner } from '../../support/mcp/harness.js';

test('tool arguments are snapshotted before awaited discovery and cannot change after validation', async () => {
  const fixture = await httpFixture();
  try {
    const add = (await fixture.catalog.all()).find(tool => tool.ref.name === 'add');
    assert.ok(add);
    const request = { ...owner, runId: parseId('run', 'r'), toolCallId: parseId('tool_call', 'c'),
      tool: { ...add.ref }, arguments: { a: 2, b: 3 } };
    const original = fixture.catalog.all.bind(fixture.catalog);
    fixture.catalog.all = async signal => {
      const tools = await original(signal);
      request.arguments.a = 100;
      return tools;
    };
    const result = await fixture.gateway.callTool(request);
    assert.equal(result.status, 'success');
    assert.deepEqual(result.structuredContent, { sum: 5 });
  } finally { await fixture.stop(); }
});

test('catalog invalidation across the discovery await prevents a stale dispatch', async () => {
  const fixture = await httpFixture();
  try {
    const add = (await fixture.catalog.all()).find(tool => tool.ref.name === 'add');
    assert.ok(add);
    const original = fixture.catalog.all.bind(fixture.catalog);
    fixture.catalog.all = async signal => {
      const tools = await original(signal);
      fixture.catalog.invalidate();
      return tools;
    };
    const result = await fixture.gateway.callTool({ ...owner, runId: parseId('run', 'r'), toolCallId: parseId('tool_call', 'c'),
      tool: add.ref, arguments: { a: 2, b: 3 } });
    assert.ok(result.status === 'error' && result.error.code === 'not_found');
    const log = await fixture.session.client.callTool({ name: 'call_log', arguments: {} });
    assert.deepEqual(log.structuredContent, { calls: ['call_log'] });
  } finally { await fixture.stop(); }
});

test('gateway owner binding is immutable even if the original host context is later reused', async () => {
  const fixture = await httpFixture();
  try {
    const mutable = { scope: owner.scope, connection: { ...owner.connection } };
    const gateway = new SdkMcpGateway(mutable, fixture.session, fixture.catalog, { clock: new TestClock(), requestTimeoutMs: 1000 });
    mutable.scope = testScope('other');
    mutable.connection.id = parseId('mcp_connection', 'other');
    assert.equal((await gateway.getCapabilities(owner)).ok, true);
    assert.equal((await gateway.getCapabilities(mutable)).ok, false);
  } finally { await fixture.stop(); }
});

test('discovery obeys total deadline even when the catalog operation ignores AbortSignal', async () => {
  const fixture = await httpFixture();
  try {
    const gateway = new SdkMcpGateway(owner, fixture.session, fixture.catalog, { clock: new TestClock(1000), requestTimeoutMs: 5000 });
    fixture.catalog.page = () => new Promise(() => {});
    const listed = await gateway.listTools(owner, { deadlineAt: 1020 });
    assert.ok(!listed.ok && listed.error.code === 'timeout');
    const result = await gateway.callTool({ ...owner, runId: parseId('run', 'r'), toolCallId: parseId('tool_call', 'c'),
      tool: { connectionId: owner.connection.id, serverId: owner.connection.serverId, name: 'add', definitionVersion: 'v1' },
      arguments: { a: 1, b: 2 } }, { deadlineAt: 1020 });
    assert.ok(result.status === 'error' && result.error.code === 'timeout');
    const log = await fixture.session.client.callTool({ name: 'call_log', arguments: {} });
    assert.deepEqual(log.structuredContent, { calls: ['call_log'] });
  } finally { await fixture.stop(); }
});

test('invalid deadlines are rejected before send, closing rejects new work, observer faults do not block cleanup', async () => {
  const fixture = await httpFixture();
  try {
    for (const deadlineAt of [NaN, Infinity]) {
      const result = await fixture.gateway.listTools(owner, { deadlineAt });
      assert.ok(!result.ok && result.error.code === 'invalid_value');
    }
    fixture.session.onInvalidate(() => { throw new Error('observer failed'); });
    let notified = false;
    fixture.session.onInvalidate(() => { notified = true; });
    const closing = fixture.close();
    const read = await fixture.gateway.getCapabilities(owner);
    assert.ok(!read.ok && read.error.code === 'connection_unavailable');
    await closing;
    assert.equal(notified, true);
  } finally { await fixture.stop(); }
});
