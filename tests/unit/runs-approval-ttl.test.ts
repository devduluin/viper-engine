import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_APPROVAL_TTL_MS, parseApprovalTtl } from '../../src/application/runs/approval-ttl.js';

test('approval TTL: default when unset, positive safe integers only', () => {
  assert.equal(parseApprovalTtl(undefined), DEFAULT_APPROVAL_TTL_MS);
  assert.equal(parseApprovalTtl(3_600_000), 3_600_000);
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) assert.throws(() => parseApprovalTtl(bad), RangeError);
});
