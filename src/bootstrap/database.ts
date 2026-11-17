import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadMigrations, migrate } from '../adapters/persistence/postgres/migrate.js';
import type { MigrationReport } from '../adapters/persistence/postgres/migrate.js';
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
