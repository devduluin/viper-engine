import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type { JsonObject } from '../../../contracts/messages/json.js';
import { ApiFailure } from '../../../contracts/api/failure.js';
import { asRow, integer, text, MS_PARAM, ownerColumns } from './rows.js';
import type { SqlQueryable } from './sql-client.js';

const OWNED = `c.actor_id = $1 AND c.app_id = $2 AND c.tenant_key = $3
  AND (s.owner_actor_id IS NULL OR s.owner_actor_id = c.actor_id)`;
const SELECT = `SELECT c.id, c.server_id, c.revision, c.auth_state,
  floor(extract(epoch FROM c.created_at)*1000)::bigint AS created_at_ms,
  floor(extract(epoch FROM c.updated_at)*1000)::bigint AS updated_at_ms
  FROM viper_engine.mcp_connections c JOIN viper_engine.mcp_servers s ON s.id = c.server_id`;

function view(value: unknown): JsonObject {
  const row = asRow(value);
  return { schemaVersion: 1, connectionId: text(row, 'id'), serverId: text(row, 'server_id'), revision: integer(row, 'revision'),
    authState: text(row, 'auth_state'), createdAt: integer(row, 'created_at_ms'), updatedAt: integer(row, 'updated_at_ms') };
}

export class PostgresApiConnections {
  constructor(private readonly tx: SqlQueryable) {}

  async createConnection(scope: TrustedScope, serverId: string, id: string, authState: 'ready' | 'authentication_required', at: number) {
    const allowed = await this.tx.query(`SELECT id FROM viper_engine.mcp_servers WHERE id = $1 AND app_id = $2
      AND tenant_key = $3 AND (owner_actor_id IS NULL OR owner_actor_id = $4) AND enabled FOR SHARE`,
    [serverId, scope.appId, scope.tenantId ?? '', scope.actorId]);
    if (allowed.rows.length === 0) throw new ApiFailure('NOT_FOUND');
    await this.tx.query(`INSERT INTO viper_engine.mcp_connections (id, actor_id, app_id, tenant_key, server_id, auth_state, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, ${MS_PARAM(7)}, ${MS_PARAM(7)}) ON CONFLICT DO NOTHING`,
    [id, ...ownerColumns(scope), serverId, authState, at]);
    const current = await this.tx.query(`${SELECT} WHERE ${OWNED} AND c.server_id = $4 AND c.revoked_at IS NULL`, [...ownerColumns(scope), serverId]);
    if (current.rows[0] === undefined) throw new Error('Connection insertion failed');
    return view(current.rows[0]);
  }

  async listConnections(scope: TrustedScope, afterId: string, limit: number) {
    const result = await this.tx.query(`${SELECT} WHERE ${OWNED} AND c.id COLLATE "C" > $4 COLLATE "C"
      ORDER BY c.id COLLATE "C" LIMIT $5`, [...ownerColumns(scope), afterId, limit]);
    return result.rows.map(view);
  }

  async disconnectConnection(scope: TrustedScope, id: string, expectedRevision: number, at: number) {
    const result = await this.tx.query(`${SELECT} WHERE ${OWNED} AND c.id = $4 FOR UPDATE OF c`, [...ownerColumns(scope), id]);
    if (result.rows[0] === undefined) throw new ApiFailure('NOT_FOUND');
    const record = view(result.rows[0]);
    if (record['revision'] !== expectedRevision) throw new ApiFailure('REVISION_CONFLICT',
      { currentRevision: record['revision']!, action: 'refresh_revision' });
    if (record['authState'] === 'revoked') return record;
    await this.tx.query(`UPDATE viper_engine.mcp_connections SET auth_state = 'revoked', revoked_at = ${MS_PARAM(2)},
      revision = revision + 1, updated_at = ${MS_PARAM(2)} WHERE id = $1`, [id, at]);
    return { ...record, authState: 'revoked', revision: expectedRevision + 1, updatedAt: at };
  }
}
