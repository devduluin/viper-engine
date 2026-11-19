import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { defineMigration, loadMigrations, migrate } from '../../../src/adapters/persistence/postgres/migrate.js';
import type { Migration } from '../../../src/adapters/persistence/postgres/migrate.js';
import { createDatabase, MIGRATIONS_DIR } from './database.js';
import type { IsolatedDatabase } from './database.js';

let migrations: readonly Migration[];
const databases: IsolatedDatabase[] = [];

async function fresh(migrated = false): Promise<IsolatedDatabase> {
  const database = await createDatabase({ migrated });
  databases.push(database);
  return database;
}

before(async () => { migrations = await loadMigrations(MIGRATIONS_DIR); });
after(async () => { await Promise.all(databases.map(database => database.drop())); });

test('fresh install applies every migration once and records checksums', async () => {
  const { pool } = await fresh();
  const versions = migrations.map(m => m.version);
  const current = versions.at(-1);
  assert.deepEqual(versions, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  assert.deepEqual(await migrate(pool, migrations), { applied: versions, current });
  assert.deepEqual(await migrate(pool, migrations), { applied: [], current });
  const tables = await pool.query(`SELECT count(*)::int AS n FROM information_schema.tables
    WHERE table_schema = 'viper_engine' AND table_name <> 'schema_migrations'`);
  assert.equal(tables.rows[0].n, 21);
  const recorded = await pool.query('SELECT version, checksum FROM viper_engine.schema_migrations ORDER BY version');
  assert.deepEqual(recorded.rows.map(row => [row.version, row.checksum]), migrations.map(m => [m.version, m.checksum]));
});

test('concurrent starters serialize on the advisory lock; exactly one applies', async () => {
  const { pool } = await fresh();
  const reports = await Promise.all([migrate(pool, migrations), migrate(pool, migrations), migrate(pool, migrations)]);
  assert.deepEqual(reports.map(report => report.applied.length).sort(), [0, 0, migrations.length]);
});

test('checksum drift, unknown versions and an unmanaged schema are refused', async () => {
  const { pool } = await fresh(true);
  const edited = migrations.map(m => m.version === 1 ? defineMigration(1, m.name, `${m.sql}\n-- edited`) : m);
  await assert.rejects(migrate(pool, edited), /Migration 1 changed after it was applied/);
  await assert.rejects(migrate(pool, migrations.slice(0, 1)), /migration \d that this build does not know/);
  const unmanaged = await fresh();
  await unmanaged.pool.query('CREATE SCHEMA viper_engine');
  await assert.rejects(migrate(unmanaged.pool, migrations), /without a migration ledger/);
});

test('CRLF checkouts produce the same checksum as LF files', () => {
  const [first] = migrations;
  assert.ok(first);
  assert.equal(defineMigration(1, first.name, first.sql.replace(/\n/g, '\r\n')).checksum, first.checksum);
});

test('a failing migration rolls back the whole batch', async () => {
  const { pool } = await fresh();
  const broken = [...migrations, defineMigration(migrations.length + 1, 'broken', 'CREATE TABLE viper_engine.x (; -- syntax error')];
  await assert.rejects(migrate(pool, broken));
  const schema = await pool.query(`SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = 'viper_engine'`);
  assert.equal(schema.rows[0].n, 0);
});

test('SQL constraint suite passes on the migrated schema', async () => {
  const { pool } = await fresh(true);
  const suite = await readFile(path.resolve('tests/integration/postgres/schema-constraints.sql'), 'utf8');
  const statements = suite.split(/\r?\n/).filter(line => !line.startsWith('\\')).join('\n');
  const results = await pool.query(statements);
  const last = [results].flat().filter(result => result.command === 'SELECT').at(-1);
  assert.equal(last?.rows[0]?.passed_checks, '45');
});
