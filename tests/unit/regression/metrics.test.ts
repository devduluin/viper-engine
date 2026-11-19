import assert from 'node:assert/strict';
import { test } from 'node:test';
import { quantile, latency, usageTotals } from '../../support/regression/metrics.js';
import { tapSummary } from '../../support/regression/suites.js';

test('nearest-rank latency reports sample count, handles empty input and rejects invalid samples', () => {
  assert.deepEqual(latency([]), { samples: 0, p50Ms: null, p95Ms: null, method: 'nearest_rank' });
  assert.equal(quantile([10, 3, 5, 7], 0.5), 5); assert.equal(quantile([10, 3, 5, 7], 0.95), 10);
  for (const fraction of [0, -1, 1.1, NaN]) assert.throws(() => quantile([1], fraction));
  assert.throws(() => latency([NaN])); assert.throws(() => latency([-1]));
});

test('usage retains per-field unknowns and does not invent billed tokens or costs', () => {
  const totals = usageTotals([{ modelCalls: 1, source: 'provider', inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    { modelCalls: 1, source: 'unavailable', inputTokens: null, outputTokens: null, totalTokens: null },
    { modelCalls: 0, source: 'unavailable', inputTokens: null, outputTokens: null, totalTokens: null }]);
  assert.deepEqual(totals.inputTokens, { known: 10, unknownTrials: 1 }); assert.equal(totals.modelCalls, 2); assert.equal(totals.billedCost, null);
});

test('TAP evidence refuses empty, ambiguous and inconsistent summary counts', () => {
  const tap = '# tests 3\n# pass 2\n# fail 1\n# skipped 0\n# cancelled 0\n';
  assert.deepEqual(tapSummary(tap), { tests: 3, passed: 2, failed: 1, skipped: 0, cancelled: 0 });
  for (const value of ['', tap + tap, tap.replace('# tests 3', '# tests 4'), tap.replace('# tests 3', '# tests 0')]) assert.throws(() => tapSummary(value));
});
