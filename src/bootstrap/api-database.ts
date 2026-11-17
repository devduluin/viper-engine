import type { ApiDatabase, ApiStores } from '../contracts/api/control.js';
import type { SqlPool } from '../adapters/persistence/postgres/sql-client.js';
import { withSnapshot, withTransaction } from '../adapters/persistence/postgres/sql-client.js';
import { transactionPool } from '../adapters/persistence/postgres/journal-commands.js';
import { PostgresApiControl } from '../adapters/persistence/postgres/api-control.js';
import { PostgresConversationStore, PostgresRunStore } from '../adapters/persistence/postgres/run-store.js';
import { PostgresApprovalStore } from '../adapters/persistence/postgres/approval-store.js';
import { PostgresMessageStore } from '../adapters/persistence/postgres/message-store.js';
import { PostgresCheckpointReader } from '../adapters/persistence/postgres/checkpoint-reader.js';
import { PostgresIdempotencyStore } from '../adapters/persistence/postgres/idempotency-store.js';
import { PostgresMcpConnectionStore } from '../adapters/persistence/postgres/mcp-connection-store.js';

function stores(pool: SqlPool): ApiStores {
  return { conversations: new PostgresConversationStore(pool), runs: new PostgresRunStore(pool),
    approvals: new PostgresApprovalStore(pool), messages: new PostgresMessageStore(pool),
    checkpoints: new PostgresCheckpointReader(pool), idempotency: new PostgresIdempotencyStore(pool), control: new PostgresApiControl(pool),
    connections: new PostgresMcpConnectionStore(pool) };
}

export function apiDatabase(pool: SqlPool): ApiDatabase {
  return { transaction: work => withTransaction(pool, tx => work(stores(transactionPool(tx)))),
    snapshot: work => withSnapshot(pool, tx => work(stores(transactionPool(tx)))) };
}
