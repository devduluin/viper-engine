import type { ActorId, AppId, TenantId } from '../identity/ids.js';
import { assertTrustedScope } from '../identity/scope.js';
import type { TrustedScope } from '../identity/scope.js';
import type { StateConflict } from './result.js';

/**
 * Persisted ownership columns. Unlike TrustedScope this is plain data: loading it from storage
 * never grants authority; it is only compared against the scope of the current request.
 */
export interface OwnerScope {
  readonly actorId: ActorId;
  readonly appId: AppId;
  /** Absent means a tenant-less deployment row; it never matches a tenant-scoped request. */
  readonly tenantId?: TenantId;
}

export function ownerFromScope(scope: TrustedScope): OwnerScope {
  assertTrustedScope(scope);
  const base = { actorId: scope.actorId, appId: scope.appId };
  return Object.freeze(scope.tenantId === undefined ? base : { ...base, tenantId: scope.tenantId });
}

export function isOwnedBy(owner: OwnerScope, scope: TrustedScope): boolean {
  assertTrustedScope(scope);
  return owner.actorId === scope.actorId && owner.appId === scope.appId && owner.tenantId === scope.tenantId;
}

/**
 * Another owner's record is reported exactly like a missing one, so callers cannot probe
 * whether an ID exists outside their scope.
 */
export function checkOwnership(owner: OwnerScope, scope: TrustedScope): StateConflict | undefined {
  return isOwnedBy(owner, scope) ? undefined : { code: 'not_found', message: 'Record not found' };
}
