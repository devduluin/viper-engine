import { McpConnectionPool } from '../../../src/adapters/mcp/client/connection-pool.js';
import { sameScope } from '../../../src/contracts/identity/scope.js';
import type { TrustedScope } from '../../../src/contracts/identity/scope.js';
import type { McpConnectionDirectory, McpConnectionRecord, McpCredential, McpCredentialPort, McpCredentialResult } from '../../../src/contracts/mcp/access.js';
import type { McpConnectionId } from '../../../src/contracts/mcp/identity.js';
import { stateConflict, stateOk } from '../../../src/contracts/state/result.js';
import { TestClock } from '../agent/identity.js';
import { testConnection, testScope } from '../agent/setup.js';

export const owner = testScope();
export const intruder = testScope('intruder');
export const connection = testConnection();
const NOT_FOUND = { code: 'not_found', message: 'Record not found' } as const;

export class MemoryDirectory implements McpConnectionDirectory {
  readonly marks: string[] = [];
  constructor(public record: McpConnectionRecord, private readonly scope: TrustedScope = owner) {}
  private owned(scope: TrustedScope, id: McpConnectionId) {
    return sameScope(scope, this.scope) && id === this.record.connection.id ? stateOk(this.record) : stateConflict<McpConnectionRecord>(NOT_FOUND);
  }
  async get(scope: TrustedScope, id: McpConnectionId) { return this.owned(scope, id); }
  async markAuthenticationRequired(scope: TrustedScope, id: McpConnectionId) {
    const found = this.owned(scope, id);
    if (found.ok && this.record.authState === 'ready') this.record = { ...this.record, authState: 'authentication_required' };
    this.marks.push('authentication_required');
    return this.owned(scope, id);
  }
  async revoke(scope: TrustedScope, id: McpConnectionId) {
    const found = this.owned(scope, id);
    if (found.ok) this.record = { ...this.record, authState: 'revoked' };
    return this.owned(scope, id);
  }
}

export class ScriptedCredentials implements McpCredentialPort {
  readonly calls: string[] = [];
  constructor(private readonly first: McpCredentialResult, private readonly refreshed?: McpCredentialResult) {}
  async resolve() { this.calls.push('resolve'); return this.first; }
  async refresh(_scope: TrustedScope, _connection: unknown, rejected: McpCredential) {
    this.calls.push(`refresh:${rejected.kind === 'bearer' ? rejected.token : rejected.kind}`);
    return this.refreshed ?? { ok: false, code: 'authentication_required' as const };
  }
}

export const bearer = (token: string): McpCredentialResult => ({ ok: true, credential: { kind: 'bearer', token } });
export const record = (overrides: Partial<McpConnectionRecord> = {}): McpConnectionRecord => ({
  connection, authState: 'ready', revision: 1,
  server: { transport: 'streamable_http', endpointRef: 'fixture', config: {}, enabled: true }, ...overrides,
});

export function pool(directory: McpConnectionDirectory, credentials: McpCredentialPort, endpoint: () => { kind: 'streamable_http'; url: string } | { kind: 'stdio'; command: string; args: string[] }) {
  return new McpConnectionPool({ directory, credentials, resolveEndpoint: endpoint,
    clock: new TestClock(Date.now()), connectTimeoutMs: 20_000, requestTimeoutMs: 5_000 });
}
