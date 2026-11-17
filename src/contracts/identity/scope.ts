import { parseId } from './ids.js';
import type { ActorId, AppId, TenantId } from './ids.js';

const trustedScopeBrand: unique symbol = Symbol('server-authenticated-scope');

/** This input must come from server-side authentication/configuration, never request JSON. */
export interface AuthenticatedIdentity {
  readonly actorId: ActorId;
  readonly appId: AppId;
  readonly tenantId?: TenantId;
}

export interface TrustedScope extends AuthenticatedIdentity {
  readonly [trustedScopeBrand]: true;
}

/** Does not authenticate a user: the adapter must authenticate before calling this boundary. */
export function scopeFromAuthenticatedIdentity(identity: AuthenticatedIdentity): TrustedScope {
  const base = {
    actorId: parseId('actor', identity.actorId),
    appId: parseId('app', identity.appId),
    [trustedScopeBrand]: true as const,
  };
  if (identity.tenantId === undefined) return Object.freeze(base);
  return Object.freeze({ ...base, tenantId: parseId('tenant', identity.tenantId) });
}

export function assertTrustedScope(scope: TrustedScope): void {
  if (scope[trustedScopeBrand] !== true) throw new Error('Scope must originate from server authentication');
}

/** Optional payload claims may confirm identity but cannot replace or clear server authority. */
export function assertScopeClaimsMatch(scope: TrustedScope, claims: unknown): void {
  assertTrustedScope(scope);
  if (claims === null || typeof claims !== 'object' || Array.isArray(claims)) {
    throw new Error('Invalid scope claims');
  }
  for (const key of ['actorId', 'appId', 'tenantId'] as const) {
    if (Object.hasOwn(claims, key) && Reflect.get(claims, key) !== scope[key]) {
      throw new Error(`Scope claim mismatch: ${key}`);
    }
  }
}

export function sameScope(left: TrustedScope, right: TrustedScope): boolean {
  assertTrustedScope(left);
  assertTrustedScope(right);
  return left.actorId === right.actorId && left.appId === right.appId && left.tenantId === right.tenantId;
}

export function assertSameScope(expected: TrustedScope, actual: TrustedScope): void {
  if (!sameScope(expected, actual)) throw new Error('Scope access denied');
}
