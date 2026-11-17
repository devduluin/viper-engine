import { randomUUID } from 'node:crypto';
import { PostgresLearningStore } from '../adapters/persistence/postgres/learning-store.js';
import type { SqlPool } from '../adapters/persistence/postgres/sql-client.js';
import { EngineLearning } from '../application/learning/service.js';
import { parseId } from '../contracts/identity/ids.js';
import type { Clock, IdGenerator } from '../contracts/identity/ports.js';

/** Idle until an authenticated host explicitly records feedback, proposes or reviews. */
export function createEngineLearning(pool: SqlPool, options: { readonly clock?: Clock; readonly ids?: IdGenerator } = {}) {
  const clock = options.clock ?? { now: () => Date.now() };
  const ids = options.ids ?? { next: <K extends string>(kind: K) => parseId(kind, `${kind}-${randomUUID()}`) };
  return new EngineLearning(new PostgresLearningStore(pool), clock, ids);
}
