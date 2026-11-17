import { randomUUID } from 'node:crypto';
import { PostgresRecallStore } from '../adapters/persistence/postgres/recall-store.js';
import type { SqlPool } from '../adapters/persistence/postgres/sql-client.js';
import { EngineRecall } from '../application/recall/service.js';
import { parseId } from '../contracts/identity/ids.js';
import type { Clock, IdGenerator } from '../contracts/identity/ports.js';

/** Authenticated host service, idle until called; no model access or automatic memory promotion. */
export function createEngineRecall(pool: SqlPool, options: { readonly clock?: Clock; readonly ids?: IdGenerator } = {}) {
  const clock = options.clock ?? { now: () => Date.now() };
  const ids = options.ids ?? { next: <K extends string>(kind: K) => parseId(kind, `${kind}-${randomUUID()}`) };
  return new EngineRecall(new PostgresRecallStore(pool), clock, ids);
}
