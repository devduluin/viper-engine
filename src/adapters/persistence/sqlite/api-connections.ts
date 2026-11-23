import { ApiFailure } from '../../../contracts/api/failure.js';
import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type { JsonObject } from '../../../contracts/messages/json.js';
import { asRow, integer, ownerColumns, text } from '../postgres/rows.js';
import type { SqlQueryable } from '../postgres/sql-client.js';

const OWNED = `c.actor_id = ? AND c.app_id = ? AND c.tenant_key = ?
  AND (s.owner_actor_id IS NULL OR s.owner_actor_id = c.actor_id)`;
const SELECT = `SELECT c.* FROM viper_engine.mcp_connections c JOIN viper_engine.mcp_servers s ON s.id = c.server_id`;

function view(value: unknown): JsonObject {
  const row = asRow(value);
  return { schemaVersion: 1, connectionId: text(row, 'id'), serverId: text(row, 'server_id'), revision: integer(row, 'revision'),
    authState: text(row, 'auth_state'), createdAt: integer(row, 'created_at_ms'), updatedAt: integer(row, 'updated_at_ms') };
}

export class SqliteApiConnections {
  constructor(private readonly tx: SqlQueryable) {}

  async createConnection(scope: TrustedScope, serverId: string, id: string, authState: 'ready' | 'authentication_required', at: number) {
    const allowed = await this.tx.query(`SELECT id FROM viper_engine.mcp_servers WHERE id = ? AND app_id = ? AND tenant_key = ?
      AND (owner_actor_id IS NULL OR owner_actor_id = ?) AND enabled = 1`, [serverId, scope.appId, scope.tenantId ?? '', scope.actorId]);
    if (allowed.rows.length === 0) throw new ApiFailure('NOT_FOUND');
    await this.tx.query(`INSERT INTO viper_engine.mcp_connections (id, actor_id, app_id, tenant_key, server_id, auth_state, created_at_ms, updated_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`, [id, ...ownerColumns(scope), serverId, authState, at, at]);
    const result = await this.tx.query(`${SELECT} WHERE ${OWNED} AND c.server_id = ? AND c.revoked_at_ms IS NULL`, [...ownerColumns(scope), serverId]);
    if (result.rows[0] === undefined) throw new Error('Connection insertion failed');
    return view(result.rows[0]);
  }

  async listConnections(scope: TrustedScope, afterId: string, limit: number) {
    const result = await this.tx.query(`${SELECT} WHERE ${OWNED} AND c.id COLLATE BINARY > ?
      ORDER BY c.id COLLATE BINARY LIMIT ?`, [...ownerColumns(scope), afterId, limit]);
    return result.rows.map(view);
  }

  async disconnectConnection(scope: TrustedScope, id: string, expectedRevision: number, at: number) {
    const result = await this.tx.query(`${SELECT} WHERE ${OWNED} AND c.id = ?`, [...ownerColumns(scope), id]);
    if (result.rows[0] === undefined) throw new ApiFailure('NOT_FOUND');
    const row = asRow(result.rows[0]);
    const currentRevision = integer(row, 'revision');
    if (currentRevision !== expectedRevision) throw new ApiFailure('REVISION_CONFLICT', { currentRevision, action: 'refresh_revision' });
    if (row['auth_state'] === 'revoked') return view(row);
    await this.tx.query(`UPDATE viper_engine.mcp_connections SET auth_state = 'revoked', revoked_at_ms = ?, revision = revision + 1,
      updated_at_ms = ? WHERE id = ? AND revision = ?`, [at, at, id, expectedRevision]);
    return { ...view(row), authState: 'revoked', revision: expectedRevision + 1, updatedAt: at };
  }
}
