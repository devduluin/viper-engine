import type { Clock } from '../../../contracts/identity/ports.js';
import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type {
  McpConnectionDirectory, McpConnectionRecord, McpCredential, McpCredentialPort, McpServerEndpoint,
} from '../../../contracts/mcp/access.js';
import type { McpConnectionId, McpContext } from '../../../contracts/mcp/identity.js';
import { connectMcp } from './connect.js';
import type { McpConnection } from './connect.js';
import { httpRefusal, McpAdmissionError } from './failures.js';
import { connectionVersion, poolKey, snapshotConnection } from './pool-access.js';
import { withDeadline } from '../../../shared/async/deadline.js';
import { assertTimerDuration } from '../../../shared/async/delay.js';
import type { McpTransportConfig } from './transport.js';
import { withCredential } from './transport.js';

export type PoolFailureCode = 'not_found' | 'revoked' | 'authentication_required' | 'connection_unavailable';

export type PoolResult =
  | { readonly ok: true; readonly connection: McpConnection }
  | { readonly ok: false; readonly code: PoolFailureCode };

export interface McpConnectionPoolOptions {
  readonly directory: McpConnectionDirectory;
  readonly credentials: McpCredentialPort;
  /** Bootstrap maps a stored server endpoint to a transport, before credentials are applied. */
  readonly resolveEndpoint: (server: McpServerEndpoint) => McpTransportConfig;
  readonly clock: Clock;
  readonly connectTimeoutMs: number;
  readonly requestTimeoutMs: number;
}

const fail = (code: PoolFailureCode): PoolResult => Object.freeze({ ok: false, code });

function admission(record: McpConnectionRecord): PoolFailureCode | undefined {
  if (record.authState === 'revoked') return 'revoked';
  if (record.authState === 'authentication_required') return 'authentication_required';
  return record.server.enabled ? undefined : 'connection_unavailable';
}

/**
 * One live MCP session per connection, opened with that connection owner's credential.
 * `acquire` re-reads the directory every time (ownership, revocation, auth state), so a cached
 * session is never handed to another scope or used after revocation, including on resume.
 */
export class McpConnectionPool {
  private readonly live = new Map<string, { connection: McpConnection; version: string; id: McpConnectionId }>();
  private readonly opening = new Map<string, Promise<PoolResult>>();
  private readonly generations = new Map<string, object>();
  private closed = false;

  constructor(private readonly options: McpConnectionPoolOptions) {
    this.options = Object.freeze({ ...options });
    assertTimerDuration('MCP connect timeout', options.connectTimeoutMs);
    assertTimerDuration('MCP request timeout', options.requestTimeoutMs);
    if (options.connectTimeoutMs === 0 || options.requestTimeoutMs === 0) throw new RangeError('MCP timeouts must be positive');
  }

  async acquire(scope: TrustedScope, id: McpConnectionId): Promise<PoolResult> {
    if (this.closed) return fail('connection_unavailable');
    const key = poolKey(scope, id);
    const record = await this.options.directory.get(scope, id);
    if (this.closed) return fail('connection_unavailable');
    if (!record.ok) return fail('not_found');
    const blocked = admission(record.value);
    if (blocked !== undefined) {
      await this.releaseKey(key);
      return fail(blocked);
    }
    const current = this.cached(key, record.value);
    if (current !== undefined) return { ok: true, connection: current };
    if (this.live.has(key)) await this.releaseKey(key);
    const generation = this.generations.get(key) ?? {};
    this.generations.set(key, generation);
    const pending = this.opening.get(key) ?? this.boundedOpen(scope, snapshotConnection(record.value), key, generation);
    this.opening.set(key, pending);
    try {
      return await pending;
    } finally {
      if (this.opening.get(key) === pending) this.opening.delete(key);
    }
  }

  private cached(key: string, record: McpConnectionRecord): McpConnection | undefined {
    const current = this.live.get(key);
    if (current === undefined || current.connection.session.closed) return undefined;
    return current.version === connectionVersion(record) ? current.connection : undefined;
  }

  /** Revokes in the directory first, then closes the session (and stdio subprocess). */
  async revoke(scope: TrustedScope, id: McpConnectionId, at: number): Promise<boolean> {
    const revoked = await this.options.directory.revoke(scope, id, at);
    if (!revoked.ok) return false;
    await this.releaseKey(poolKey(scope, id));
    return true;
  }

  async release(id: McpConnectionId): Promise<void> {
    const matching = [...this.live.entries()].filter(([, entry]) => entry.id === id).map(([key]) => key);
    // Opening entries have no live session yet; their key still contains the connection ID.
    const pending = [...this.opening.keys()].filter(key => JSON.parse(key)[3] === id);
    await Promise.all([...new Set([...matching, ...pending])].map(key => this.releaseKey(key)));
  }

  async closeAll(): Promise<void> {
    this.closed = true;
    const opening = [...this.opening.values()];
    await Promise.all([...new Set([...this.live.keys(), ...this.opening.keys()])].map(key => this.releaseKey(key)));
    await Promise.allSettled(opening);
  }

  private async releaseKey(key: string): Promise<void> {
    this.generations.delete(key);
    this.opening.delete(key);
    const current = this.live.get(key);
    this.live.delete(key);
    await current?.connection.close();
  }

  private async boundedOpen(scope: TrustedScope, record: McpConnectionRecord, key: string, generation: object): Promise<PoolResult> {
    try {
      const result = await withDeadline(signal => this.open(scope, record, () => this.authorize(scope, record, key, generation, signal)),
        { operationName: 'MCP connection open', timeoutMs: this.options.connectTimeoutMs });
      if (!result.ok && this.generations.get(key) === generation) await this.releaseKey(key);
      return result;
    } catch {
      if (this.generations.get(key) === generation) await this.releaseKey(key);
      return fail('connection_unavailable');
    }
  }

  private async authorize(scope: TrustedScope, record: McpConnectionRecord, key: string, generation: object, signal: AbortSignal): Promise<void> {
    const active = () => !this.closed && !signal.aborted && this.generations.get(key) === generation;
    if (!active()) throw new McpAdmissionError('connection_unavailable');
    const latest = await this.options.directory.get(scope, record.connection.id);
    if (!active()) throw new McpAdmissionError('connection_unavailable');
    if (!latest.ok) { await this.releaseKey(key); throw new McpAdmissionError('not_found'); }
    const blocked = admission(latest.value);
    if (blocked !== undefined) { await this.releaseKey(key); throw new McpAdmissionError(blocked === 'revoked' ? 'permission' : blocked); }
    if (connectionVersion(latest.value) !== connectionVersion(record)) {
      await this.releaseKey(key); throw new McpAdmissionError('connection_unavailable');
    }
  }

  private async open(scope: TrustedScope, record: McpConnectionRecord, authorize: () => Promise<void>): Promise<PoolResult> {
    const owner: McpContext = Object.freeze({ scope, connection: record.connection });
    const resolved = await this.options.credentials.resolve(scope, record.connection);
    if (!resolved.ok) return this.credentialFailure(scope, record, resolved.code);
    await authorize();
    const first = await this.connect(owner, record.server, resolved.credential, authorize);
    if (first !== 'unauthorized') return first;
    const refreshed = await this.options.credentials.refresh(scope, record.connection, resolved.credential);
    if (!refreshed.ok) return this.credentialFailure(scope, record, refreshed.code);
    await authorize();
    const second = await this.connect(owner, record.server, refreshed.credential, authorize);
    return second === 'unauthorized' ? this.credentialFailure(scope, record, 'authentication_required') : second;
  }

  private async connect(owner: McpContext, server: McpServerEndpoint, credential: McpCredential, authorize: () => Promise<void>): Promise<PoolResult | 'unauthorized'> {
    let connection: McpConnection | undefined;
    try {
      const config = withCredential(this.options.resolveEndpoint(server), credential);
      connection = await connectMcp(owner, config, {
        clock: this.options.clock, connectTimeoutMs: this.options.connectTimeoutMs, requestTimeoutMs: this.options.requestTimeoutMs,
        authorize,
      });
      await authorize();
      const latest = await this.options.directory.get(owner.scope, owner.connection.id);
      await authorize();
      if (!latest.ok) { await connection.close(); return fail('not_found'); }
      this.live.set(poolKey(owner.scope, owner.connection.id), { connection, version: connectionVersion(latest.value), id: owner.connection.id });
      return { ok: true, connection };
    } catch (error) {
      await connection?.close();
      return httpRefusal(error) === 'authentication_required' ? 'unauthorized' : fail('connection_unavailable');
    }
  }

  private async credentialFailure(scope: TrustedScope, record: McpConnectionRecord, code: 'authentication_required' | 'revoked'): Promise<PoolResult> {
    if (code === 'authentication_required') {
      await this.options.directory.markAuthenticationRequired(scope, record.connection.id, this.options.clock.now());
    }
    return fail(code);
  }
}
