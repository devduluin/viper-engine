import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadMigrations, migrate, schemaStatus } from '../adapters/persistence/postgres/migrate.js';
import type { MigrationReport, SchemaStatus } from '../adapters/persistence/postgres/migrate.js';
import type { SqlPool } from '../adapters/persistence/postgres/sql-client.js';
import type { DatabaseConfig } from './database-config.js';
import { assertMigrationVersion } from './schema-version.js';
import { isSqlitePool } from './database-dialect.js';
import { migrateSqlitePrototype, sqliteSchemaStatus } from '../adapters/persistence/sqlite/migrate.js';
import type { SqliteFiles, SqlitePool } from '../adapters/persistence/sqlite/pool.js';
export type { SqliteFiles, SqlitePool } from '../adapters/persistence/sqlite/pool.js';

/** Build copies SQL assets beside the compiled adapters; callers may pass another directory. */
export const MIGRATIONS_DIRECTORY = fileURLToPath(new URL('../adapters/persistence/postgres/migrations/', import.meta.url));

export type DatabasePool = pg.Pool & SqlPool;

export async function openSqliteDatabase(files: SqliteFiles): Promise<SqlitePool> {
  const { SqlitePool: Pool } = await import('../adapters/persistence/sqlite/pool.js');
  return new Pool(files);
}

export function createDatabasePool(config: DatabaseConfig): DatabasePool {
  return new pg.Pool({
    host: config.host, port: config.port, database: config.database, user: config.user,
    ...(config.password === undefined ? {} : { password: config.password }),
    ...(config.ssl ? { ssl: { rejectUnauthorized: true } } : {}),
    max: config.maxConnections,
    connectionTimeoutMillis: 5000,
    application_name: 'viper-engine',
  });
}

export async function migrateDatabase(pool: SqlPool, directory = MIGRATIONS_DIRECTORY): Promise<MigrationReport> {
  if (isSqlitePool(pool)) return migrateSqlitePrototype(pool);
  return migrate(pool, await engineMigrations(directory));
}

async function engineMigrations(directory: string) {
  const migrations = await loadMigrations(directory);
  assertMigrationVersion(migrations.at(-1)?.version);
  return migrations;
}

/** The engine's database is missing migrations or does not match this build. Message says what to do. */
export class SchemaNotReadyError extends Error {
  constructor(readonly status: SchemaStatus) {
    super(schemaMessage(status));
    this.name = 'SchemaNotReadyError';
  }
}

function schemaMessage(status: SchemaStatus): string {
  const needs = status.expected === undefined ? '' : ` (this build needs version ${status.expected})`;
  if (status.problem === 'not_migrated') return `Viper database is not migrated${needs}; run \`npm run db:migrate\` against it`;
  if (status.problem === 'pending') return `Viper database schema is at version ${status.current}${needs}; run \`npm run db:migrate\``;
  return `Viper database schema does not match this build: ${status.detail ?? 'unknown difference'}`;
}

/**
 * Startup guard for hosts (worker/HTTP). Read-only and fail closed when migration assets are missing
 * or unreadable: a ledger alone cannot establish compatibility with the current build.
 */
export async function assertSchemaReady(pool: SqlPool, directory = MIGRATIONS_DIRECTORY): Promise<SchemaStatus> {
  const status = isSqlitePool(pool) ? await sqliteSchemaStatus(pool) : await schemaStatus(pool, await engineMigrations(directory));
  if (!status.ready) throw new SchemaNotReadyError(status);
  return status;
}
