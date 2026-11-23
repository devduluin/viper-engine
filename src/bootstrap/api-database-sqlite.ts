import { transactionPool } from '../adapters/persistence/postgres/journal-commands.js';
import type { SqlQueryable } from '../adapters/persistence/postgres/sql-client.js';
import { SqliteApiControl } from '../adapters/persistence/sqlite/api-control.js';
import { SqliteApprovalStore } from '../adapters/persistence/sqlite/approval-store.js';
import { SqliteCheckpointReader } from '../adapters/persistence/sqlite/checkpoint-reader.js';
import { SqliteIdempotencyStore } from '../adapters/persistence/sqlite/idempotency-store.js';
import { SqliteMcpConnectionStore } from '../adapters/persistence/sqlite/mcp-connection-store.js';
import { SqliteMessageStore } from '../adapters/persistence/sqlite/message-store.js';
import type { SqlitePool } from '../adapters/persistence/sqlite/pool.js';
import { SqliteConversationStore, SqliteRunStore } from '../adapters/persistence/sqlite/run-store.js';
import type { ApiDatabase, ApiStores } from '../contracts/api/control.js';

function stores(tx: SqlQueryable, clock: () => number): ApiStores {
  const pool = transactionPool(tx);
  return { conversations: new SqliteConversationStore(pool), runs: new SqliteRunStore(pool, clock),
    approvals: new SqliteApprovalStore(pool, clock), messages: new SqliteMessageStore(pool, clock),
    checkpoints: new SqliteCheckpointReader(pool, clock), idempotency: new SqliteIdempotencyStore(pool),
    control: new SqliteApiControl(tx, clock), connections: new SqliteMcpConnectionStore(pool) };
}

export function sqliteApiDatabase(pool: SqlitePool, clock: () => number = Date.now): ApiDatabase {
  return { transaction: work => pool.transaction(tx => work(stores(tx, clock))),
    snapshot: work => pool.snapshot(tx => work(stores(tx, clock))) };
}
