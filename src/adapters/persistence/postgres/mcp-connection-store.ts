import { parseId } from '../../../contracts/identity/ids.js';
import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type { McpAuthState, McpConnectionDirectory, McpConnectionRecord } from '../../../contracts/mcp/access.js';
import type { McpConnectionId } from '../../../contracts/mcp/identity.js';
import { parseJsonObject } from '../../../contracts/messages/json.js';
import { stateConflict, stateOk } from '../../../contracts/state/result.js';
import type { StateResult } from '../../../contracts/state/result.js';
import { NOT_FOUND } from './run-lock.js';
import { asRow, integer, member, MS_PARAM, ownerColumns, text } from './rows.js';
import type { SqlPool } from './sql-client.js';

const AUTH_STATES: readonly McpAuthState[] = ['ready', 'authentication_required', 'revoked'];
const TRANSPORTS = ['stdio', 'streamable_http'] as const;

/**
 * Owner predicate shared by every statement: another actor/app/tenant, or a private server
 * that belongs to someone else, is indistinguishable from a missing row.
 */
const OWNED = `c.id = $1 AND c.actor_id = $2 AND c.app_id = $3 AND c.tenant_key = $4
  AND (s.owner_actor_id IS NULL OR s.owner_actor_id = c.actor_id)`;

const SELECT = `SELECT c.id, c.server_id, c.auth_state, c.revision, s.transport, s.endpoint_ref, s.config, s.enabled
  FROM viper_engine.mcp_connections c JOIN viper_engine.mcp_servers s ON s.id = c.server_id`;

function record(value: unknown): McpConnectionRecord {
  const row = asRow(value);
  const enabled = row['enabled'];
  if (typeof enabled !== 'boolean') throw new Error('Unexpected database value: enabled');
  return Object.freeze({
    connection: Object.freeze({ id: parseId('mcp_connection', row['id']), serverId: parseId('mcp_server', row['server_id']) }),
    authState: member(row, 'auth_state', AUTH_STATES), revision: integer(row, 'revision'),
    server: Object.freeze({
      transport: member(row, 'transport', TRANSPORTS), endpointRef: text(row, 'endpoint_ref'),
      config: parseJsonObject(row['config']), enabled,
    }),
  });
}

/** `mcp_connections` as the per-user connection directory (P05-03). */
export class PostgresMcpConnectionStore implements McpConnectionDirectory {
  constructor(private readonly pool: SqlPool) {}

  async get(scope: TrustedScope, id: McpConnectionId): Promise<StateResult<McpConnectionRecord>> {
    const result = await this.pool.query(`${SELECT} WHERE ${OWNED}`, [id, ...ownerColumns(scope)]);
    return result.rows[0] === undefined ? stateConflict(NOT_FOUND) : stateOk(record(result.rows[0]));
  }

  /** ready -> authentication_required; a revoked connection stays revoked. */
  async markAuthenticationRequired(scope: TrustedScope, id: McpConnectionId, at: number) {
    return this.update(scope, id, at, `auth_state = 'authentication_required'`, `c.auth_state = 'ready'`);
  }

  /** Idempotent; revocation is final for this row. */
  async revoke(scope: TrustedScope, id: McpConnectionId, at: number) {
    return this.update(scope, id, at, `auth_state = 'revoked', revoked_at = ${MS_PARAM(5)}`, 'c.revoked_at IS NULL');
  }

  private async update(scope: TrustedScope, id: McpConnectionId, at: number, set: string, guard: string): Promise<StateResult<McpConnectionRecord>> {
    await this.pool.query(`UPDATE viper_engine.mcp_connections AS target
        SET ${set}, revision = target.revision + 1, updated_at = ${MS_PARAM(5)}
      FROM viper_engine.mcp_connections c JOIN viper_engine.mcp_servers s ON s.id = c.server_id
      WHERE target.id = c.id AND ${OWNED} AND ${guard}`, [id, ...ownerColumns(scope), at]);
    return this.get(scope, id);
  }
}
