import assert from 'node:assert/strict';
import test from 'node:test';
import { parseId } from '../../../src/contracts/identity/ids.js';
import type { ActorId, AppId, EntityId, ToolCallId } from '../../../src/contracts/identity/ids.js';
import type { Clock, IdGenerator } from '../../../src/contracts/identity/ports.js';
import {
  assertSameScope, assertScopeClaimsMatch, sameScope, scopeFromAuthenticatedIdentity,
} from '../../../src/contracts/identity/scope.js';
import type { TrustedScope } from '../../../src/contracts/identity/scope.js';

function scope(actor = 'actor-1', app = 'app-1', tenant?: string): TrustedScope {
  const identity = { actorId: parseId('actor', actor), appId: parseId('app', app) };
  return scopeFromAuthenticatedIdentity(tenant === undefined ? identity : { ...identity, tenantId: parseId('tenant', tenant) });
}

test('opaque identifiers preserve exact provider subjects and custom entity namespaces', () => {
  const actor: ActorId = parseId('actor', 'auth0|Case-Sensitive/subject');
  const app: AppId = parseId('app', 'viper-business');
  const call: ToolCallId = parseId('tool_call', 'provider-call-01');
  assert.equal(actor, 'auth0|Case-Sensitive/subject');
  assert.equal(app, 'viper-business');
  assert.equal(call, 'provider-call-01');
  assert.equal(parseId('mcp_connection', 'connection:1'), 'connection:1');
});

test('identifier validation rejects empty, whitespace, control, nonstring and oversized IDs', () => {
  const invalid: unknown[] = ['', ' user', 'user ', 'two users', 'line\nbreak', '\u0000', '\u200b', 1, null, undefined, 'x'.repeat(257)];
  for (const value of invalid) assert.throws(() => parseId('actor', value), /Invalid actor identifier/);
  assert.throws(() => parseId('', 'value'), /identifier kind/);
  assert.throws(() => parseId('not-a-kind', 'value'), /identifier kind/);
});

test('server identity creates an immutable scope without introducing an absent tenant', () => {
  const trusted = scope();
  assert.equal(Object.isFrozen(trusted), true);
  assert.equal(Object.hasOwn(trusted, 'tenantId'), false);
  assert.deepEqual(JSON.parse(JSON.stringify(trusted)), { actorId: 'actor-1', appId: 'app-1' });
  assert.doesNotThrow(() => assertScopeClaimsMatch(trusted, {}));
  assert.doesNotThrow(() => assertScopeClaimsMatch(trusted, { actorId: 'actor-1', appId: 'app-1' }));
});

test('payload actor, app and tenant overrides cannot replace authenticated scope', () => {
  const trusted = scope('actor-1', 'app-1', 'tenant-1');
  for (const claims of [{ actorId: 'actor-2' }, { appId: 'app-2' }, { tenantId: 'tenant-2' }, { tenantId: null }, { tenantId: undefined }]) {
    assert.throws(() => assertScopeClaimsMatch(trusted, claims), /Scope claim mismatch/);
  }
  assert.equal(trusted.actorId, 'actor-1');
  assert.equal(trusted.appId, 'app-1');
  assert.equal(trusted.tenantId, 'tenant-1');
  assert.throws(() => assertScopeClaimsMatch(scope(), { tenantId: 'tenant-1' }), /tenantId/);
  assert.throws(() => assertScopeClaimsMatch(trusted, null), /Invalid scope claims/);
});

test('resource access compares actor, app and exact optional tenant', () => {
  const trusted = scope('actor-1', 'app-1', 'tenant-1');
  assert.equal(sameScope(trusted, scope('actor-1', 'app-1', 'tenant-1')), true);
  for (const other of [scope('actor-2', 'app-1', 'tenant-1'), scope('actor-1', 'app-2', 'tenant-1'), scope(), scope('actor-1', 'app-1', 'tenant-2')]) {
    assert.throws(() => assertSameScope(trusted, other), /Scope access denied/);
  }
  assert.equal(sameScope(scope(), scope()), true);
});

test('JSON payload cannot impersonate a trusted scope instance', () => {
  const forged = JSON.parse(JSON.stringify(scope())) as TrustedScope;
  assert.throws(() => assertScopeClaimsMatch(forged, {}), /server authentication/);
  assert.throws(() => sameScope(scope(), forged), /server authentication/);
});

test('Clock and ID generation ports accept deterministic injected adapters', () => {
  const clock: Clock = { now: () => 1_800_000_000_000 };
  let sequence = 0;
  const ids: IdGenerator = {
    next: <Kind extends string>(kind: Kind): EntityId<Kind> => parseId(kind, `fixture-${++sequence}`),
  };
  const run = { id: ids.next('run'), startedAt: clock.now() };
  const step = { id: ids.next('step'), startedAt: clock.now() };
  assert.deepEqual(run, { id: 'fixture-1', startedAt: 1_800_000_000_000 });
  assert.deepEqual(step, { id: 'fixture-2', startedAt: 1_800_000_000_000 });
});
