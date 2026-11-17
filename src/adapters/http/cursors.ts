import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Clock } from '../../contracts/identity/ports.js';
import type { TrustedScope } from '../../contracts/identity/scope.js';
import { parseJsonObject } from '../../contracts/messages/json.js';
import { ApiFailure } from '../../contracts/api/failure.js';
import type { ApiCursorPort } from '../../contracts/api/control.js';
import { createFingerprint } from '../../shared/fingerprints/fingerprint.js';

type Kind = Parameters<ApiCursorPort['issue']>[1];
export class SignedApiCursors implements ApiCursorPort {
  private readonly secret: Buffer;
  constructor(secret: Uint8Array, private readonly clock: Clock, private readonly ttlMs: number) {
    if (secret.byteLength < 32) throw new Error('Cursor signing secret requires at least 32 bytes');
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1000) throw new Error('Invalid cursor lifetime');
    this.secret = Buffer.from(secret);
  }

  issue(scope: TrustedScope, kind: Kind, resource: string, position: string): string {
    const data = JSON.stringify({ v: 1, kind, resource, position, owner: this.owner(scope), expires: this.clock.now() + this.ttlMs });
    const token = Buffer.from(JSON.stringify({ data, mac: this.mac(data).toString('base64url') })).toString('base64url');
    if (token.length > 2048) throw new Error('Cursor exceeds wire limit');
    return token;
  }

  read(scope: TrustedScope, kind: Kind, resource: string, token: string): string {
    try {
      if (!/^[A-Za-z0-9_-]{1,2048}$/.test(token)) throw new Error('Invalid token');
      const envelope = parseJsonObject(JSON.parse(Buffer.from(token, 'base64url').toString('utf8')));
      if (typeof envelope['data'] !== 'string' || typeof envelope['mac'] !== 'string') throw new Error('Invalid envelope');
      const expected = this.mac(envelope['data']); const actual = Buffer.from(envelope['mac'], 'base64url');
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('Invalid signature');
      return this.payload(scope, kind, resource, envelope['data']);
    } catch (error) {
      if (error instanceof ApiFailure) throw error;
      throw new ApiFailure('INVALID_CURSOR');
    }
  }

  private payload(scope: TrustedScope, kind: Kind, resource: string, data: string): string {
    const p = parseJsonObject(JSON.parse(data));
    if (p['v'] !== 1 || p['kind'] !== kind || p['resource'] !== resource || p['owner'] !== this.owner(scope)
      || typeof p['position'] !== 'string' || typeof p['expires'] !== 'number') throw new Error('Invalid cursor binding');
    if (p['expires'] <= this.clock.now()) throw new ApiFailure(kind === 'event' ? 'EVENT_CURSOR_EXPIRED' : 'INVALID_CURSOR',
      kind === 'event' ? { runId: resource, action: 'fetch_snapshot' } : undefined);
    return p['position'];
  }

  private owner(scope: TrustedScope): string {
    return createFingerprint({ actor: scope.actorId, app: scope.appId, tenant: scope.tenantId ?? '' }, { domain: 'api.cursor.owner', version: '1' });
  }
  private mac(data: string): Buffer { return createHmac('sha256', this.secret).update(data).digest(); }
}
