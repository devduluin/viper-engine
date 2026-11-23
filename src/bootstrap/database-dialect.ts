import type { SqlitePool } from '../adapters/persistence/sqlite/pool.js';

/** Detects an engine-created SQLite pool without loading node:sqlite for PostgreSQL users. */
export function isSqlitePool(pool: object): pool is SqlitePool {
  return 'dialect' in pool && pool.dialect === 'sqlite';
}
