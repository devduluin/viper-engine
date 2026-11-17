import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabase } from './database.js';
import { http } from './http-fixtures.js';
import { worker } from './worker-fixtures.js';
import { anthropic } from './engine-fixtures.js';
import { SchemaNotReadyError, assertSchemaReady, MIGRATIONS_DIRECTORY } from '../../../src/bootstrap/database.js';
import { loadMigrations, schemaStatus } from '../../../src/adapters/persistence/postgres/migrate.js';

test('schema status: unmigrated, partially migrated, current and drifted databases', async () => {
  const empty = await createDatabase({ migrated: false });
  const migrated = await createDatabase();
  try {
    const migrations = await loadMigrations(MIGRATIONS_DIRECTORY);
    const latest = migrations.at(-1)!.version;
    assert.deepEqual(await schemaStatus(empty.pool, migrations), { ready: false, current: 0, expected: latest, problem: 'not_migrated' });
    assert.deepEqual(await schemaStatus(empty.pool), { ready: false, current: 0, problem: 'not_migrated' });
    assert.deepEqual(await schemaStatus(migrated.pool, migrations), { ready: true, current: latest, expected: latest });
    assert.deepEqual(await schemaStatus(migrated.pool), { ready: true, current: latest });
    assert.deepEqual(await assertSchemaReady(migrated.pool), { ready: true, current: latest, expected: latest });
    await assert.rejects(assertSchemaReady(empty.pool), (error: unknown) => error instanceof SchemaNotReadyError
      && /not migrated .*needs version \d+.*npm run db:migrate/.test(error.message));
    await migrated.pool.query('DELETE FROM viper_engine.schema_migrations WHERE version = $1', [latest]);
    const pending = await schemaStatus(migrated.pool, migrations);
    assert.deepEqual([pending.ready, pending.current, pending.problem], [false, latest - 1, 'pending']);
    await assert.rejects(assertSchemaReady(migrated.pool), new RegExp(`at version ${latest - 1} \\(this build needs version ${latest}\\)`));
    await migrated.pool.query("UPDATE viper_engine.schema_migrations SET checksum = repeat('0', 64) WHERE version = 1");
    const drifted = await schemaStatus(migrated.pool, migrations);
    assert.deepEqual([drifted.ready, drifted.problem], [false, 'mismatch']);
    assert.match(String(drifted.detail), /Migration 1 changed/);
  } finally { await empty.drop(); await migrated.drop(); }
});

test('a worker on an unmigrated database fails fast with an actionable error', async () => {
  const db = await createDatabase({ migrated: false });
  const host = worker(db.pool, anthropic([]).model);
  try {
    host.start();
    await assert.rejects(host.done, (error: unknown) => error instanceof SchemaNotReadyError && /npm run db:migrate/.test(error.message));
    assert.equal(host.status().phase, 'failed');
    await assert.rejects(host.stop(), SchemaNotReadyError);
  } finally { await host.stop().catch(() => undefined); await db.drop(); }
});

test('schemaCheck: false keeps the old behaviour (host takes responsibility)', async () => {
  const db = await createDatabase({ migrated: false });
  const host = worker(db.pool, anthropic([]).model, {}, { schemaCheck: false });
  try {
    host.start();
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(host.status().phase, 'running');
    // Old behaviour on an empty database: generic failures, and shutdown may report "Worker shutdown failed".
    await host.stop().catch((error: unknown) => assert.doesNotMatch(String(error), /SchemaNotReady/));
  } finally { await host.stop().catch(() => undefined); await db.drop(); }
});

test('the HTTP server refuses to become ready on an unmigrated database; a migrated one is ready', async () => {
  const empty = await createDatabase({ migrated: false });
  const migrated = await createDatabase();
  const bad = http(empty.pool); const good = http(migrated.pool);
  try {
    await assert.rejects(async () => { await bad.ready(); }, SchemaNotReadyError);
    await good.ready();
  } finally { await bad.close().catch(() => undefined); await good.close(); await empty.drop(); await migrated.drop(); }
});
