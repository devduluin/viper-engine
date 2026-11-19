import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stateConflict } from '../../../src/contracts/state/result.js';
import { startHttpServer } from '../../support/mcp/harness.js';
import { connection, intruder, MemoryDirectory, owner, pool, record, ScriptedCredentials } from '../../support/mcp/pool-fixtures.js';

test('owner access disappearing retires the live MCP session without letting another scope close it', async () => {
  const server = await startHttpServer(); const directory = new MemoryDirectory(record());
  const get = directory.get.bind(directory); let visible = true;
  directory.get = async (scope, id) => visible ? get(scope, id) : stateConflict({ code: 'not_found', message: 'Record not found' });
  const subject = pool(directory, new ScriptedCredentials({ ok: true, credential: { kind: 'none' } }),
    () => ({ kind: 'streamable_http', url: server.url }));
  try {
    const acquired = await subject.acquire(owner, connection.id); assert.ok(acquired.ok);
    assert.deepEqual(await subject.acquire(intruder, connection.id), { ok: false, code: 'not_found' });
    assert.equal(acquired.connection.session.closed, false);
    visible = false;
    assert.deepEqual(await subject.acquire(owner, connection.id), { ok: false, code: 'not_found' });
    assert.equal(acquired.connection.session.closed, true);
  } finally { await subject.closeAll(); await server.stop(); }
});
