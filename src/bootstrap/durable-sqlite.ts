import { SqliteCheckpointReader } from '../adapters/persistence/sqlite/checkpoint-reader.js';
import { SqliteRunLeaseStore } from '../adapters/persistence/sqlite/lease-store.js';
import type { SqlitePool } from '../adapters/persistence/sqlite/pool.js';
import { SqliteRunJournal } from '../adapters/persistence/sqlite/run-journal.js';
import { SqliteRunSteering } from '../adapters/persistence/sqlite/run-steering.js';
import { SqliteRunStore } from '../adapters/persistence/sqlite/run-store.js';
import { DurableRunDriver } from '../application/durable/driver.js';
import type { DurableDriverDependencies } from '../application/durable/types.js';

/** SQLite worker composition for S0 tests. Schema and connection lifecycle belong to the caller. */
export function createSqliteDurableRunDriver(pool: SqlitePool,
  deps: Omit<DurableDriverDependencies, 'leases' | 'runs' | 'checkpoints' | 'journal' | 'steeringInputs'>, historyLimit?: number): DurableRunDriver {
  const clock = () => deps.clock.now();
  return new DurableRunDriver({ ...deps, leases: new SqliteRunLeaseStore(pool, clock), runs: new SqliteRunStore(pool, clock),
    checkpoints: new SqliteCheckpointReader(pool, clock, historyLimit), journal: new SqliteRunJournal(pool, clock, historyLimit),
    steeringInputs: new SqliteRunSteering(pool) });
}
