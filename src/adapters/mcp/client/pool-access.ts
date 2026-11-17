import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type { McpConnectionRecord } from '../../../contracts/mcp/access.js';
import type { McpConnectionId } from '../../../contracts/mcp/identity.js';
import { createFingerprint } from '../../../shared/fingerprints/fingerprint.js';
import { parseJsonObject } from '../../../contracts/messages/json.js';

export function snapshotConnection(record: McpConnectionRecord): McpConnectionRecord {
  return Object.freeze({ ...record, connection: Object.freeze({ ...record.connection }),
    server: Object.freeze({ ...record.server, config: parseJsonObject(record.server.config) }) });
}

export function poolKey(scope: TrustedScope, id: McpConnectionId): string {
  return JSON.stringify([scope.actorId, scope.appId, scope.tenantId ?? null, id]);
}

/** Endpoint/config/revision changes retire an existing session, even if its transport lives. */
export function connectionVersion(record: McpConnectionRecord): string {
  return createFingerprint({ connection: { ...record.connection }, revision: record.revision,
    authState: record.authState, server: { ...record.server } }, { domain: 'viper.mcp.session_binding', version: '1' });
}
