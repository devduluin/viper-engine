import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadMigrations, migrate, schemaStatus } from '../adapters/persistence/postgres/migrate.js';
import type { MigrationReport, SchemaStatus } from '../adapters/persistence/postgres/migrate.js';
import type { SqlPool } from '../adapters/persistence/postgres/sql-client.js';
import type { DatabaseConfig } from './database-config.js';

/** Source-tree migrations; a packaged build must copy them or pass another directory. */
export const MIGRATIONS_DIRECTORY = fileURLToPath(new URL('../adapters/persistence/postgres/migrations/', import.meta.url));

export type DatabasePool = pg.Pool & SqlPool;

export function createDatabasePool(config: DatabaseConfig): DatabasePool {
  return new pg.Pool({
    host: config.host, port: config.port, database: config.database, user: config.user,
    ...(config.password === undefined ? {} : { password: config.password }),
    ...(config.ssl ? { ssl: { rejectUnauthorized: true } } : {}),
    max: config.maxConnections,
    application_name: 'viper-engine',
  });
}

export async function migrateDatabase(pool: SqlPool, directory = MIGRATIONS_DIRECTORY): Promise<MigrationReport> {
  return migrate(pool, await loadMigrations(directory));
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
 * Startup guard for hosts (worker/HTTP). Read-only. If this build's migration files cannot be read
 * (packaged without them), only "the database was migrated at all" is required.
 */
export async function assertSchemaReady(pool: SqlPool, directory = MIGRATIONS_DIRECTORY): Promise<SchemaStatus> {
  const migrations = await loadMigrations(directory).catch(() => undefined);
  const status = await schemaStatus(pool, migrations);
  if (!status.ready) throw new SchemaNotReadyError(status);
  return status;
}
