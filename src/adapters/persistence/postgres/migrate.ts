import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { SqlPool, SqlQueryable } from './sql-client.js';
import { withTransaction } from './sql-client.js';

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
  /** SHA-256 of the LF-normalized file, so Windows checkouts do not look like drift. */
  readonly checksum: string;
}

export interface MigrationReport {
  readonly applied: readonly number[];
  readonly current: number;
}

const FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;
const LOCK_KEY = 'viper_engine.schema_migrations';

export function defineMigration(version: number, name: string, sql: string): Migration {
  const normalized = sql.replace(/\r\n/g, '\n');
  const checksum = createHash('sha256').update(normalized, 'utf8').digest('hex');
  return Object.freeze({ version, name, sql: normalized, checksum });
}

/** Loads `NNNN_name.sql` files; versions must start at 1 and be contiguous. */
export async function loadMigrations(directory: string): Promise<readonly Migration[]> {
  const names = (await readdir(directory)).filter(name => name.endsWith('.sql')).sort();
  const migrations: Migration[] = [];
  for (const [index, file] of names.entries()) {
    const match = FILE_PATTERN.exec(file);
    if (match === null || Number(match[1]) !== index + 1) throw new Error(`Unexpected migration file: ${file}`);
    migrations.push(defineMigration(index + 1, match[2] ?? file, await readFile(path.join(directory, file), 'utf8')));
  }
  if (migrations.length === 0) throw new Error('No migrations found');
  return Object.freeze(migrations);
}

async function prepareSchema(tx: SqlQueryable): Promise<void> {
  const state = await tx.query(`SELECT
      EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'viper_engine') AS has_schema,
      to_regclass('viper_engine.schema_migrations') IS NOT NULL AS has_ledger`);
  const row = state.rows[0];
  const hasSchema = Reflect.get(Object(row), 'has_schema') === true;
  const hasLedger = Reflect.get(Object(row), 'has_ledger') === true;
  if (hasSchema && !hasLedger) throw new Error('Schema viper_engine exists without a migration ledger; refusing to adopt it');
  if (hasSchema) return;
  await tx.query('CREATE SCHEMA viper_engine');
  await tx.query(`CREATE TABLE viper_engine.schema_migrations (
      version integer PRIMARY KEY CHECK (version >= 1),
      name text NOT NULL,
      checksum char(64) NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
      applied_at timestamptz NOT NULL DEFAULT now())`);
}

async function appliedChecksums(tx: SqlQueryable): Promise<ReadonlyMap<number, string>> {
  const result = await tx.query('SELECT version, checksum FROM viper_engine.schema_migrations ORDER BY version');
  return new Map(result.rows.map(row => [Number(Reflect.get(Object(row), 'version')), String(Reflect.get(Object(row), 'checksum'))]));
}

function pendingMigrations(migrations: readonly Migration[], applied: ReadonlyMap<number, string>): readonly Migration[] {
  for (const [version, checksum] of applied) {
    const known = migrations.find(migration => migration.version === version);
    if (known === undefined) throw new Error(`Database has migration ${version} that this build does not know`);
    if (known.checksum !== checksum) throw new Error(`Migration ${version} changed after it was applied`);
  }
  return migrations.filter(migration => !applied.has(migration.version));
}

/**
 * Applies pending migrations in one transaction under an advisory lock, so concurrent starters
 * serialize. It touches only the `viper_engine` schema of the database the pool points at.
 */
export async function migrate(pool: SqlPool, migrations: readonly Migration[]): Promise<MigrationReport> {
  return withTransaction(pool, async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [LOCK_KEY]);
    await prepareSchema(tx);
    const pending = pendingMigrations(migrations, await appliedChecksums(tx));
    for (const migration of pending) {
      await tx.query(migration.sql);
      await tx.query('INSERT INTO viper_engine.schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
        [migration.version, migration.name, migration.checksum]);
    }
    return Object.freeze({
      applied: Object.freeze(pending.map(migration => migration.version)),
      current: migrations.at(-1)?.version ?? 0,
    });
  });
}
