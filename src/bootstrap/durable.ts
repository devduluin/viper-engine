import { DurableRunDriver } from '../application/durable/driver.js';
import type { DurableDriverDependencies } from '../application/durable/types.js';
import type { SqlPool } from '../adapters/persistence/postgres/sql-client.js';
import { PostgresRunLeaseStore } from '../adapters/persistence/postgres/lease-store.js';
import { PostgresRunStore } from '../adapters/persistence/postgres/run-store.js';
import { PostgresCheckpointReader } from '../adapters/persistence/postgres/checkpoint-reader.js';
import { PostgresRunSteering } from '../adapters/persistence/postgres/run-steering.js';
import { PostgresRunJournal } from '../adapters/persistence/postgres/run-journal.js';
import { createSqliteDurableRunDriver } from './durable-sqlite.js';
import { isSqlitePool } from './database-dialect.js';

/** Host owns the pool lifecycle and supplies provider-neutral model/MCP/policy/configuration. */
export function createDurableRunDriver(pool: SqlPool, deps: Omit<DurableDriverDependencies, 'leases' | 'runs' | 'checkpoints' | 'journal' | 'steeringInputs'>): DurableRunDriver {
  if (isSqlitePool(pool)) return createSqliteDurableRunDriver(pool, deps);
  return new DurableRunDriver({ ...deps, leases: new PostgresRunLeaseStore(pool), runs: new PostgresRunStore(pool),
    checkpoints: new PostgresCheckpointReader(pool), journal: new PostgresRunJournal(pool), steeringInputs: new PostgresRunSteering(pool) });
}
