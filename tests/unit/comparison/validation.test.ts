import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capture, observation } from './fixtures.js';
import { parseComparisonEvidence } from '../../support/comparison/validation.js';
import { pairedInterval, trialMetrics, ratio } from '../../support/comparison/statistics.js';

test('comparison evidence rejects duplicate tasks/trials, omitted checks and contradictory critical pass', () => {
  const base = capture('hermes'); assert.equal(parseComparisonEvidence(base).engine, 'hermes');
  for (const extra of [{ engine: 'pretend-engine' }, { schemaVersion: 2 }, { executable: 'whoami' }, { tasks: [] },
    { tasks: [base.tasks[0], base.tasks[0]] }, { conditions: { ...base.conditions, model: 'unpinned' } }]) {
    assert.throws(() => parseComparisonEvidence({ ...base, ...extra }));
  }
  for (const trials of [[observation(), observation()], [{ ...observation(), passed: true, criticalFailure: true }],
    [{ ...observation(), modelCalls: -1 }], [{ ...observation(), costUsd: 5 }]]) {
    assert.throws(() => parseComparisonEvidence({ ...base, tasks: [{ ...base.tasks[0], trials }] }));
  }
  assert.throws(() => parseComparisonEvidence({ ...base, tasks: [{ ...base.tasks[0], status: 'not_measured' }] }));
});

test('bootstrap is deterministic, bounded and respects negative/degenerate paired task outcomes', () => {
  assert.equal(pairedInterval([0]), null);
  assert.equal(pairedInterval([0, 0], 7, 100)?.lower, 0);
  assert.equal(pairedInterval([-1, -1], 7, 100)?.upper, -1);
  assert.deepEqual(pairedInterval([-1, 0, 1], 7, 100), pairedInterval([-1, 0, 1], 7, 100));
  assert.throws(() => pairedInterval([2, 0])); assert.throws(() => pairedInterval([0, 1], -1));
  assert.throws(() => pairedInterval([0, 1], 7, 0));
});

test('estimated and unavailable costs stay out of billed ratios, and zero denominator never becomes infinity', () => {
  assert.equal(trialMetrics([observation()]).billedCostPerPassingTrialUsd, null);
  assert.equal(trialMetrics([{ ...observation(), costUsd: 1, costProvenance: 'estimate' }]).billedCostUsd, null);
  assert.equal(trialMetrics([{ ...observation(), costUsd: 1, costProvenance: 'billed' }]).billedCostPerPassingTrialUsd, 1);
  assert.equal(ratio(null, 1), null); assert.equal(ratio(1, 0), null); assert.equal(ratio(1, 2), 0.5);
});
