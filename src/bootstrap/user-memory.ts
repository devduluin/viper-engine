import { randomUUID } from 'node:crypto';
import type { SqlPool } from '../adapters/persistence/postgres/sql-client.js';
import { PostgresUserMemoryStore } from '../adapters/persistence/postgres/user-memory-store.js';
import { SqliteUserMemoryStore } from '../adapters/persistence/sqlite/user-memory-store.js';
import { isSqlitePool } from './database-dialect.js';
import { UserMemory } from '../application/recall/user-memory.js';
import { createEngineRecall } from './recall.js';
import { parseId } from '../contracts/identity/ids.js';

export function createUserMemory(pool: SqlPool) {
  const clock = { now: () => Date.now() };
  const ids = { next: <K extends string>(kind: K) => parseId(kind, `${kind}-${randomUUID()}`) };
  const store = isSqlitePool(pool) ? new SqliteUserMemoryStore(pool, clock, ids) : new PostgresUserMemoryStore(pool, clock, ids);
  return new UserMemory(createEngineRecall(pool, { clock, ids }), store);
}

export function userMemoryOptions(pool: SqlPool, enabled: boolean | undefined) {
  return enabled === true ? { userMemory: createUserMemory(pool) } : {};
}
