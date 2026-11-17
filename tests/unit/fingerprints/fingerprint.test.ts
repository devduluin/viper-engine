import assert from 'node:assert/strict';
import test from 'node:test';
import { createFingerprint } from '../../../src/shared/fingerprints/fingerprint.js';

const approval = { domain: 'approval', version: 'v1' };

test('fingerprints are full SHA-256 and separate domain/version from payload', () => {
  const digest = createFingerprint({ a: 1 }, approval);
  assert.match(digest, /^[a-f0-9]{64}$/);
  // Independent Python hashlib vector for the documented v1 byte encoding.
  assert.equal(digest, '775b8948bcaec6efe2b8eb7572d8e99625a07ea0a3f76dbd66fa70d5b0c7cb0c');
  assert.notEqual(digest, createFingerprint({ a: 1 }, { domain: 'cache', version: 'v1' }));
  assert.notEqual(digest, createFingerprint({ a: 1 }, { domain: 'approval', version: 'v2' }));
  assert.equal(createFingerprint({ b: 2, a: { d: 4, c: 3 } }, approval), createFingerprint({ a: { c: 3, d: 4 }, b: 2 }, approval));
});

test('every approval binding field changes the snapshot fingerprint', () => {
  const base = { actor: 'a', app: 'app', tenant: 't', run: 'r', connection: 'c', server: 's', tool: 'write', definitionVersion: 'v1', arguments: { amount: 1 } };
  const original = createFingerprint(base, approval);
  for (const key of ['actor', 'app', 'tenant', 'run', 'connection', 'server', 'tool', 'definitionVersion'] as const) {
    assert.notEqual(original, createFingerprint({ ...base, [key]: 'different' }, approval));
  }
  assert.notEqual(original, createFingerprint({ ...base, arguments: { amount: 2 } }, approval));
});

test('invalid domains/versions and lossy payloads fail rather than returning a reusable token', () => {
  for (const context of [{ domain: '', version: 'v1' }, { domain: 'approval\0cache', version: 'v1' }, { domain: 'approval', version: '' }]) {
    assert.throws(() => createFingerprint({}, context));
  }
  assert.throws(() => createFingerprint({ a: undefined }, approval));
  assert.throws(() => createFingerprint({ a: NaN }, approval));
});
