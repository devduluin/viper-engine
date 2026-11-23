import { DatabaseSync } from 'node:sqlite';
import type { Migration } from '../postgres/migrate.js';
import { asRow, integer } from '../postgres/rows.js';
import type { SqlQueryable } from '../postgres/sql-client.js';

export type SqliteSchema = 'viper_engine' | 'viper_pro';

/** A valid ledger also needs the tables, indexes and guards created by those migrations. */
export async function verifyMigrationSchema(tx: SqlQueryable, migrations: readonly Migration[], schema: SqliteSchema): Promise<void> {
  const sql = `SELECT type, name, tbl_name, sql FROM ${schema}.sqlite_schema
    WHERE name NOT GLOB 'sqlite_*' AND name <> 'schema_migrations' ORDER BY type, name`;
  const reference = new DatabaseSync(':memory:');
  try {
    reference.exec(`PRAGMA foreign_keys = ON; ATTACH DATABASE ':memory:' AS ${schema}`);
    for (const migration of migrations) reference.exec(migration.sql);
    const expected = reference.prepare(sql).all();
    const actual = (await tx.query(sql)).rows;
    if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error(`Managed SQLite schema objects do not match migrations in ${schema}`);
  } finally { reference.close(); }
}

export async function recordedMigrations(tx: SqlQueryable, migrations: readonly Migration[], schema: SqliteSchema = 'viper_engine'): Promise<number> {
  const versionRow = (await tx.query(`PRAGMA ${schema}.user_version`)).rows[0];
  const version = integer(asRow(versionRow), 'user_version');
  if (version < 0 || version > migrations.length) throw new Error(`Unsupported SQLite schema version: ${version}`);
  if (version === 0) {
    const objects = await tx.query(`SELECT name FROM ${schema}.sqlite_schema WHERE name NOT GLOB 'sqlite_*' LIMIT 1`);
    if (objects.rows.length !== 0) throw new Error('SQLite schema exists without a verified migration ledger');
    return 0;
  }
  const ledger = await tx.query(`SELECT version, name, checksum FROM ${schema}.schema_migrations ORDER BY version`);
  if (ledger.rows.length !== version) throw new Error('SQLite migration count does not match its schema version');
  checkChecksums(ledger.rows, migrations);
  return version;
}

function checkChecksums(rows: readonly unknown[], migrations: readonly Migration[]) {
  for (const [index, value] of rows.entries()) {
    const row = asRow(value);
    const expected = migrations[index];
    if (expected === undefined || row['version'] !== expected.version || row['name'] !== expected.name || row['checksum'] !== expected.checksum) {
      throw new Error(`SQLite migration ${index + 1} checksum or identity mismatch`);
    }
  }
}
