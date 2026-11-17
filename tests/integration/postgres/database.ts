import { randomBytes } from 'node:crypto';
import path from 'node:path';
import pg from 'pg';
import { loadMigrations, migrate } from '../../../src/adapters/persistence/postgres/migrate.js';
import type { SqlPool } from '../../../src/adapters/persistence/postgres/sql-client.js';
import { createDatabasePool } from '../../../src/bootstrap/database.js';
import { isLoopbackHost, parseDatabaseConfig } from '../../../src/bootstrap/database-config.js';
import type { DatabaseConfig } from '../../../src/bootstrap/database-config.js';

export const MIGRATIONS_DIR = path.resolve('src/adapters/persistence/postgres/migrations');

/**
 * Integration tests need explicit VIPER_TEST_DB_* settings and never guess a server. Only a
 * loopback server is accepted; tests only create/drop their own `viper_it_*` databases on it.
 * VIPER_TEST_DB_NAME is the maintenance database used to issue CREATE/DROP DATABASE.
 */
export function testServerConfig(): DatabaseConfig {
  const config = parseDatabaseConfig(process.env, 'VIPER_TEST_DB');
  if (!isLoopbackHost(config.host)) throw new Error('Integration tests only run against a loopback PostgreSQL server');
  return config;
}

export interface IsolatedDatabase {
  readonly name: string;
  readonly pool: pg.Pool & SqlPool;
  drop(): Promise<void>;
}

async function admin<T>(server: DatabaseConfig, work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({
    host: server.host, port: server.port, database: server.database, user: server.user,
    ...(server.password === undefined ? {} : { password: server.password }),
  });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/** Fresh empty database; `migrated` applies the real migrations through the runner. */
export async function createDatabase(options: { readonly migrated?: boolean } = {}): Promise<IsolatedDatabase> {
  const server = testServerConfig();
  const name = `viper_it_${process.pid}_${randomBytes(4).toString('hex')}`;
  await admin(server, client => client.query(`CREATE DATABASE ${name}`));
  const pool = createDatabasePool({ ...server, database: name, maxConnections: 8 });
  if (options.migrated !== false) await migrate(pool, await loadMigrations(MIGRATIONS_DIR));
  return {
    name, pool,
    async drop() {
      await pool.end();
      await admin(server, client => client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
    },
  };
}
