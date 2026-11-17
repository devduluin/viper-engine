import { parseId } from '../../../src/contracts/identity/ids.js';
import type { TrustedScope } from '../../../src/contracts/identity/scope.js';
import type { McpToolRef } from '../../../src/contracts/mcp/identity.js';
import { APPROVAL_ARGUMENTS_DIGEST, parseArgumentsDigest } from '../../../src/contracts/state/approval-state.js';
import { createFingerprint } from '../../../src/shared/fingerprints/fingerprint.js';
import type { NewRunEvent, RunEventType } from '../../../src/contracts/state/events.js';
import { PostgresApprovalStore } from '../../../src/adapters/persistence/postgres/approval-store.js';
import { PostgresRunEventReader } from '../../../src/adapters/persistence/postgres/run-event-reader.js';
import { PostgresConversationStore, PostgresRunStore } from '../../../src/adapters/persistence/postgres/run-store.js';
import type { SqlConnection, SqlPool } from '../../../src/adapters/persistence/postgres/sql-client.js';
import { PostgresToolCallLedger } from '../../../src/adapters/persistence/postgres/tool-call-ledger.js';
import { testScope } from '../../support/agent/setup.js';

export const AT = 1_800_000_000_000;
export const owner = testScope('actor-a', 'app-a');
export const other = testScope('actor-b', 'app-a');
export const tenanted = testScope('actor-a', 'app-a', 'tenant-1');
export const ARGS = Object.freeze({ id: 'a' });
/** Real digest of ARGS, so approval snapshots verify. */
export const digest = parseArgumentsDigest(createFingerprint(ARGS, APPROVAL_ARGUMENTS_DIGEST));
export const proposalSnapshot = Object.freeze({
  arguments: ARGS, toolSnapshot: { description: 'Lookup', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
});

let counter = 0;
export function event(type: RunEventType, extra: Partial<NewRunEvent> = {}): NewRunEvent {
  counter += 1;
  return { eventId: parseId('run_event', `ev-${process.pid}-${counter}`), type, occurredAt: AT, payload: {}, ...extra };
}

export function stores(pool: SqlPool) {
  return {
    conversations: new PostgresConversationStore(pool), runs: new PostgresRunStore(pool),
    calls: new PostgresToolCallLedger(pool), approvals: new PostgresApprovalStore(pool),
    events: new PostgresRunEventReader(pool),
  };
}

/**
 * MCP config has no store yet; tests insert the server and the owner's connection directly.
 * One live connection per owner and server is a schema rule, so an existing one is reused.
 */
export async function seedConnection(pool: SqlPool, scope: TrustedScope, id: string): Promise<McpToolRef> {
  const tenant = scope.tenantId ?? '';
  const serverId = `server-${tenant || 'none'}`;
  await pool.query(`INSERT INTO viper_engine.mcp_servers (id, app_id, tenant_key, transport, endpoint_ref)
    VALUES ($1, $2, $3, 'stdio', 'ref:test') ON CONFLICT DO NOTHING`, [serverId, scope.appId, tenant]);
  const inserted = await pool.query(`INSERT INTO viper_engine.mcp_connections (id, actor_id, app_id, tenant_key, server_id, auth_state)
    VALUES ($1, $2, $3, $4, $5, 'ready') ON CONFLICT DO NOTHING RETURNING id`, [id, scope.actorId, scope.appId, tenant, serverId]);
  const live = inserted.rowCount === 1 ? inserted : await pool.query(`SELECT id FROM viper_engine.mcp_connections
    WHERE actor_id = $1 AND app_id = $2 AND tenant_key = $3 AND server_id = $4 AND revoked_at IS NULL`,
  [scope.actorId, scope.appId, tenant, serverId]);
  return {
    connectionId: parseId('mcp_connection', Reflect.get(Object(live.rows[0]), 'id')),
    serverId: parseId('mcp_server', serverId), name: 'lookup', definitionVersion: 'v1',
  };
}

/** Conversation + run (queued -> running) owned by `scope`. */
export async function seedRun(pool: SqlPool, scope: TrustedScope, suffix: string) {
  const s = stores(pool);
  const conversationId = parseId('conversation', `conv-${suffix}`);
  const runId = parseId('run', `run-${suffix}`);
  await s.conversations.create(scope, { id: conversationId, at: AT });
  const created = await s.runs.create(scope, { id: runId, conversationId, at: AT, events: [event('run.queued')] });
  if (!created.ok) throw new Error('seed run failed');
  const running = await s.runs.transition(scope, runId, { to: 'running', expectedRevision: 1, at: AT, events: [event('run.started')] });
  if (!running.ok) throw new Error('seed transition failed');
  return { conversationId, runId };
}

/**
 * Pool wrapper that pauses after each run-row read, so concurrent writers overlap for real.
 * Without a row lock they would all read the same revision inside this window.
 */
export function overlappingPool(pool: SqlPool, pauseMs = 150): SqlPool {
  const pause = () => new Promise(resolve => setTimeout(resolve, pauseMs));
  const wrap = (connection: SqlConnection): SqlConnection => ({
    release: error => connection.release(error),
    async query(text, values) {
      const result = await connection.query(text, values);
      if (/^SELECT .* FROM viper_engine\.runs WHERE id = \$1/s.test(text)) await pause();
      return result;
    },
  });
  return { query: (text, values) => pool.query(text, values), connect: async () => wrap(await pool.connect()) };
}
