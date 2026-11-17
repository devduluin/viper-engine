import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PostgresMcpConnectionStore } from '../../../src/adapters/persistence/postgres/mcp-connection-store.js';
import { parseId } from '../../../src/contracts/identity/ids.js';
import { createDatabase } from './database.js';
import type { IsolatedDatabase } from './database.js';
import { AT, other, owner, tenanted } from './fixtures.js';

let db: IsolatedDatabase;
before(async () => {
  db = await createDatabase();
  await db.pool.query(`INSERT INTO viper_engine.mcp_servers (id, app_id, tenant_key, owner_actor_id, transport, endpoint_ref, config, enabled) VALUES
    ('srv-shared', 'app-a', '', NULL, 'streamable_http', 'https://mcp.example.com/mcp', '{"timeoutMs":5000}', true),
    ('srv-private-b', 'app-a', '', 'actor-b', 'stdio', 'cmd:b', '{}', true),
    ('srv-off', 'app-a', '', NULL, 'stdio', 'cmd:off', '{}', false)`);
  await db.pool.query(`INSERT INTO viper_engine.mcp_connections (id, actor_id, app_id, tenant_key, server_id, auth_state) VALUES
    ('conn-a', 'actor-a', 'app-a', '', 'srv-shared', 'ready'),
    ('conn-b', 'actor-b', 'app-a', '', 'srv-shared', 'ready'),
    ('conn-a-on-private-b', 'actor-a', 'app-a', '', 'srv-private-b', 'ready'),
    ('conn-a-off', 'actor-a', 'app-a', '', 'srv-off', 'ready')`);
});
after(async () => { await db.drop(); });

const id = (value: string) => parseId('mcp_connection', value);

test('the owner sees the connection with its server endpoint; others see not_found', async () => {
  const store = new PostgresMcpConnectionStore(db.pool);
  const mine = await store.get(owner, id('conn-a'));
  assert.deepEqual(mine, { ok: true, value: {
    connection: { id: 'conn-a', serverId: 'srv-shared' }, authState: 'ready', revision: 1,
    server: { transport: 'streamable_http', endpointRef: 'https://mcp.example.com/mcp', config: { timeoutMs: 5000 }, enabled: true },
  } });
  for (const [scope, target] of [[other, 'conn-a'], [tenanted, 'conn-a'], [owner, 'conn-b'], [owner, 'conn-a-on-private-b'], [owner, 'missing']] as const) {
    assert.deepEqual(await store.get(scope, id(target)), { ok: false, error: { code: 'not_found', message: 'Record not found' } });
  }
  const off = await store.get(owner, id('conn-a-off'));
  assert.ok(off.ok && off.value.server.enabled === false);
});

test('auth-required and revocation are owner-only, monotonic and idempotent', async () => {
  const store = new PostgresMcpConnectionStore(db.pool);
  assert.equal((await store.revoke(other, id('conn-a'), AT)).ok, false);
  assert.equal((await store.markAuthenticationRequired(other, id('conn-a'), AT)).ok, false);
  const marked = await store.markAuthenticationRequired(owner, id('conn-a'), AT);
  assert.ok(marked.ok && marked.value.authState === 'authentication_required' && marked.value.revision === 2);
  const revoked = await store.revoke(owner, id('conn-a'), AT + 1);
  assert.ok(revoked.ok && revoked.value.authState === 'revoked' && revoked.value.revision === 3);
  const again = await store.revoke(owner, id('conn-a'), AT + 2);
  assert.ok(again.ok && again.value.revision === 3);
  const stays = await store.markAuthenticationRequired(owner, id('conn-a'), AT + 3);
  assert.ok(stays.ok && stays.value.authState === 'revoked');
  const row = await db.pool.query(`SELECT (extract(epoch FROM revoked_at) * 1000)::bigint AS at FROM viper_engine.mcp_connections WHERE id = 'conn-a'`);
  assert.equal(Number(row.rows[0].at), AT + 1);
  const untouched = await store.get(other, id('conn-b'));
  assert.ok(untouched.ok && untouched.value.authState === 'ready');
});
