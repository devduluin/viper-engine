import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createDatabasePool, parseDatabaseConfig, migrateDatabase, assertSchemaReady, SchemaNotReadyError,
  startEngineHost, createEngineHttpServer, createEngineClient, parseId } from '../../../dist/index.js';

// Child receives only explicit test DB settings and OS process variables. No source runtime imports.
const pool = createDatabasePool(parseDatabaseConfig(process.env, 'VIPER_TEST_DB'));
function diagnosis(ready, code) {
  const settings = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('VIPER_TEST_DB_'))
    .map(([key, value]) => [key.replace('VIPER_TEST_DB_', 'VIPER_DB_'), value]));
  const result = spawnSync(process.execPath, ['dist/bootstrap/operations/check-cli.js'], {
    env: { ...process.env, ...settings }, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(result.status, ready ? 0 : 1, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ready, ready); assert.equal(output.code, code);
}
let host; let stage; let modelCalls = 0;
const model = { provider: 'scripted-fixture', model: 'operations-smoke', gateway: {
  capabilities: { toolCalling: true, streaming: false, structuredOutput: false, contentTypes: ['text'] },
  generate: async () => { modelCalls++; return { ok: true, decision: { kind: 'final', content: [{ type: 'text', text: 'Fixture finished' }] },
    usage: { source: 'unavailable', inputTokens: null, outputTokens: null, totalTokens: null } }; },
} };
const options = {
  http: { cursorSecret: Buffer.alloc(32, 5), authenticate: async token => token === 'fixture-owner'
    ? { actorId: parseId('actor', 'owner'), appId: parseId('app', 'operations') } : undefined, authorizeServer: async () => false },
  engine: { model, credentials: { resolve: async () => ({ ok: true, credential: { kind: 'none' } }),
    refresh: async () => ({ ok: false, code: 'authentication_required' }) }, connections: async () => [],
    resolveEndpoint: () => { throw new Error('No MCP connections in this fixture'); }, policy: { decide: () => 'reject' } },
  worker: { concurrency: 1, pollMs: 20, maintenanceMs: 100, shutdownTimeoutMs: 5000 },
  listen: { host: '127.0.0.1', port: 0 },
};
try {
  diagnosis(false, 'not_migrated');
  await assert.rejects(startEngineHost(pool, options), SchemaNotReadyError);
  assert.equal(modelCalls, 0);
  const first = await migrateDatabase(pool); assert.ok(first.applied.length >= 13);
  assert.deepEqual((await migrateDatabase(pool)).applied, []);
  assert.equal((await assertSchemaReady(pool)).expected, first.current);
  diagnosis(true, 'ready');
  // Persist a queued run through HTTP, then close that host before starting a worker host.
  stage = createEngineHttpServer(pool, options.http);
  const previousAddress = await stage.listen(options.listen);
  const previousClient = createEngineClient({ baseUrl: previousAddress, getToken: async () => 'fixture-owner' });
  const conversation = await previousClient.createConversation();
  const run = await previousClient.startRun(conversation.conversationId,
    { input: { content: [{ type: 'text', text: 'Finish the isolated setup fixture' }] } }, 'operations-smoke');
  // A bind failure must clean up its idle worker without claiming queued work or closing the caller pool.
  await assert.rejects(startEngineHost(pool, { ...options, listen: { host: '127.0.0.1', port: Number(new URL(previousAddress).port) } }),
    error => error.code === 'EADDRINUSE');
  assert.equal((await previousClient.run(run.runId)).status, 'queued'); assert.equal(modelCalls, 0);
  await stage.close();
  const listen = Object.freeze({ host: '127.0.0.1', port: 0 });
  host = await startEngineHost(pool, { ...options, listen });
  assert.deepEqual(listen, { host: '127.0.0.1', port: 0 }); // Fastify must not mutate caller options.
  const headers = { authorization: 'Bearer fixture-owner' };
  assert.equal((await fetch(`${host.address}/health/live`)).status, 401);
  assert.deepEqual(await (await fetch(`${host.address}/health/live`, { headers })).json(), { status: 'alive' });
  assert.equal((await fetch(`${host.address}/health/ready`, { headers })).status, 200);
  const client = createEngineClient({ baseUrl: host.address, getToken: async () => 'fixture-owner' });
  let snapshot;
  for (let i = 0; i < 200; i++) {
    snapshot = await client.run(run.runId); if (snapshot.status === 'completed') break;
    await delay(20);
  }
  assert.equal(snapshot?.status, 'completed'); assert.equal(modelCalls, 1);
  await pool.query("UPDATE viper_engine.schema_migrations SET checksum = repeat('0',64) WHERE version = 1");
  diagnosis(false, 'mismatch');
  const notReady = await fetch(`${host.address}/health/ready`, { headers });
  assert.equal(notReady.status, 503); assert.deepEqual(await notReady.json(), { ready: false, code: 'schema_not_ready' });
  assert.equal((await fetch(`${host.address}/health/live`, { headers })).status, 200);
  await host.close(); await host.close(); await host.done;
  assert.equal((await host.readiness()).code, 'draining');
  assert.equal(host.workerStatus().phase, 'stopped');
  await pool.query('SELECT 1'); // Caller still owns the pool.
  console.log(JSON.stringify({ passed: true, compiledOnly: true, migrations: first.current, persistedRun: snapshot.status,
    modelCalls, healthAuth: 401, readinessBefore: 200, readinessAfterDrift: 503, cleanShutdown: true }));
} finally { await host?.close(); await stage?.close(); await pool.end(); }
