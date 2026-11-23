import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type { McpConnectionDirectory, McpConnectionRecord } from '../../../contracts/mcp/access.js';
import type { McpConnectionId } from '../../../contracts/mcp/identity.js';
import { stateConflict, stateOk } from '../../../contracts/state/result.js';
import type { StateResult } from '../../../contracts/state/result.js';
import { decodeConnection } from '../postgres/mcp-connection-store.js';
import { NOT_FOUND } from '../postgres/run-lock.js';
import { asRow, ownerColumns, text } from '../postgres/rows.js';
import { withTransaction } from '../postgres/sql-client.js';
import type { SqlPool, SqlQueryable } from '../postgres/sql-client.js';

async function getConnection(db: SqlQueryable, scope: TrustedScope, id: McpConnectionId): Promise<StateResult<McpConnectionRecord>> {
  const result = await db.query(`SELECT c.id, c.server_id, c.auth_state, c.revision, s.transport, s.endpoint_ref, s.config, s.enabled
    FROM viper_engine.mcp_connections c JOIN viper_engine.mcp_servers s ON s.id = c.server_id
    WHERE c.id = ? AND c.actor_id = ? AND c.app_id = ? AND c.tenant_key = ?
      AND (s.owner_actor_id IS NULL OR s.owner_actor_id = c.actor_id)`, [id, ...ownerColumns(scope)]);
  if (result.rows[0] === undefined) return stateConflict(NOT_FOUND);
  const row = asRow(result.rows[0]);
  return stateOk(decodeConnection({ ...row, enabled: row['enabled'] === 1, config: JSON.parse(text(row, 'config')) }));
}

export class SqliteMcpConnectionStore implements McpConnectionDirectory {
  constructor(private readonly pool: SqlPool) {}

  get(scope: TrustedScope, id: McpConnectionId) {
    return getConnection(this.pool, scope, id);
  }

  markAuthenticationRequired(scope: TrustedScope, id: McpConnectionId, at: number) {
    return this.update(scope, id, at, 'authentication_required');
  }

  revoke(scope: TrustedScope, id: McpConnectionId, at: number) {
    return this.update(scope, id, at, 'revoked');
  }

  private async update(scope: TrustedScope, id: McpConnectionId, at: number, target: 'authentication_required' | 'revoked') {
    return withTransaction(this.pool, async tx => {
      const existing = await getConnection(tx, scope, id);
      if (!existing.ok || existing.value.authState === 'revoked' || existing.value.authState === target) return existing;
      await tx.query(`UPDATE viper_engine.mcp_connections SET auth_state = ?, revoked_at_ms = ?, revision = revision + 1,
        updated_at_ms = ? WHERE id = ?`, [target, target === 'revoked' ? at : null, at, id]);
      return getConnection(tx, scope, id);
    });
  }
}
