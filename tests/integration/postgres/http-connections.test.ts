import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabase } from './database.js';
import { owner, other } from './fixtures.js';
import { http, request, field, errorCode } from './http-fixtures.js';

async function server(db: Awaited<ReturnType<typeof createDatabase>>, id: string, privateOwner: string | null = null) {
  await db.pool.query(`INSERT INTO viper_engine.mcp_servers(id, app_id, tenant_key, owner_actor_id, transport, endpoint_ref, config)
    VALUES ($1, $2, '', $3, 'stdio', 'PRIVATE_BACKEND_COMMAND', '{"secret_ref":"PRIVATE_REFERENCE"}')`, [id, owner.appId, privateOwner]);
}

test('connections require host grant plus DB scope, expose no config and enforce CAS revoke', async () => {
  const db = await createDatabase(); const app = http(db.pool);
  try {
    await server(db, 'shared'); await server(db, 'private', other.actorId);
    const body = await request(app, 'POST', '/api/v1/mcp/connections', { serverId: 'shared' }, { status: 201, schema: 'ConnectionView' });
    const id = field(body, 'connectionId');
    assert.ok(!JSON.stringify(body).includes('PRIVATE'));
    const privateServer = await request(app, 'POST', '/api/v1/mcp/connections', { serverId: 'private' }, { status: 404 });
    assert.equal(errorCode(privateServer), 'NOT_FOUND');
    await request(app, 'POST', '/api/v1/mcp/connections', { serverId: 'shared' }, { token: 'tenant', status: 404 });
    const url = `/api/v1/mcp/connections/${id}/disconnect`;
    await request(app, 'POST', url, { expectedRevision: 1 }, { token: 'other', status: 404 });
    const stale = await request(app, 'POST', url, { expectedRevision: 2 }, { status: 409 });
    assert.equal(errorCode(stale), 'REVISION_CONFLICT');
    const revoked = await request(app, 'POST', url, { expectedRevision: 1 }, { status: 200, schema: 'ConnectionView' });
    assert.equal(revoked['authState'], 'revoked');
    assert.deepEqual(await request(app, 'POST', url, { expectedRevision: 2 }, { status: 200 }), revoked);
    const page = await request(app, 'GET', '/api/v1/mcp/connections', undefined, { status: 200, schema: 'ConnectionPage' });
    assert.deepEqual(page['items'], [revoked]);
    assert.deepEqual((await request(app, 'GET', '/api/v1/mcp/connections', undefined, { token: 'other', status: 200 }))['items'], []);
    const renewed = await request(app, 'POST', '/api/v1/mcp/connections', { serverId: 'shared' }, { status: 201 });
    assert.notEqual(renewed['connectionId'], id);
  } finally { await app.close(); await db.drop(); }
});

test('connection authorization denial is NOT_FOUND; unready authorization stays explicit', async () => {
  const db = await createDatabase(); const denied = http(db.pool, { authorizeServer: async () => false });
  const auth = http(db.pool, { authorizeServer: async () => 'authentication_required' });
  try {
    await server(db, 'authorized');
    await request(denied, 'POST', '/api/v1/mcp/connections', { serverId: 'authorized' }, { status: 404 });
    const result = await request(auth, 'POST', '/api/v1/mcp/connections', { serverId: 'authorized' }, { status: 201 });
    assert.equal(result['authState'], 'authentication_required');
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM viper_engine.mcp_connections')).rows[0].n, 1);
  } finally { await denied.close(); await auth.close(); await db.drop(); }
});
