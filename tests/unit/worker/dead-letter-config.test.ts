import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_MAX_DELIVERY_FAILURES, parseMaxDeliveryFailures } from '../../../src/bootstrap/worker/dead-letter.js';

test('max delivery failures: default when unset, positive bounded integers only', () => {
  assert.equal(parseMaxDeliveryFailures(undefined), DEFAULT_MAX_DELIVERY_FAILURES);
  assert.equal(parseMaxDeliveryFailures(3), 3);
  for (const bad of [0, -1, 1.5, Number.NaN, 10_001]) assert.throws(() => parseMaxDeliveryFailures(bad), RangeError);
});
