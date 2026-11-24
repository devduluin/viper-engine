import { API_SPIKE_SCHEMA } from './api-schema.js';
import { APPROVAL_SPIKE_SCHEMA } from './approval-schema.js';
import { IDEMPOTENCY_SPIKE_SCHEMA } from './idempotency-schema.js';
import { JOURNAL_SPIKE_SCHEMA } from './journal-schema.js';
import { MESSAGE_SPIKE_SCHEMA } from './message-schema.js';
import type { SqlitePool } from './pool.js';
import { RUN_SPIKE_SCHEMA } from './run-schema.js';
import { RECALL_SCHEMA } from './recall-schema.js';
import { LEARNING_EVIDENCE_SCHEMA } from './learning-evidence-schema.js';
import { LEARNING_SCHEMA } from './learning-schema.js';
import { LEARNING_GUARDS } from './learning-guards.js';
import { AGENT_RUNS_SCHEMA } from './agent-schema.js';
import { defineMigration } from '../postgres/migrate.js';
import type { MigrationReport, SchemaStatus } from '../postgres/migrate.js';

const MIGRATIONS = Object.freeze([
  defineMigration(1, 'durable_api', [RUN_SPIKE_SCHEMA, MESSAGE_SPIKE_SCHEMA, APPROVAL_SPIKE_SCHEMA, JOURNAL_SPIKE_SCHEMA,
    IDEMPOTENCY_SPIKE_SCHEMA, API_SPIKE_SCHEMA].join('\n')),
  defineMigration(2, 'scoped_recall', RECALL_SCHEMA),
  defineMigration(3, 'outcome_learning', LEARNING_SCHEMA + LEARNING_EVIDENCE_SCHEMA + LEARNING_GUARDS),
  defineMigration(4, 'agent_runs', AGENT_RUNS_SCHEMA),
]);

export function migrateSqlitePrototype(pool: SqlitePool): Promise<MigrationReport> {
  return pool.migrateSeries(MIGRATIONS);
}

export async function sqliteSchemaStatus(pool: SqlitePool): Promise<SchemaStatus> {
  const expected = MIGRATIONS.length;
  try {
    const current = await pool.migrationVersion(MIGRATIONS);
    if (current === expected) return { ready: true, current, expected };
    return { ready: false, current, expected, problem: current === 0 ? 'not_migrated' : 'pending' };
  } catch (error) {
    return { ready: false, current: 0, expected, problem: 'mismatch', detail: error instanceof Error ? error.message : 'SQLite schema unreadable' };
  }
}

/** For upgrade tests that must build an older schema version first. */
export const SQLITE_MIGRATIONS = MIGRATIONS;
