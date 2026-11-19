import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capture } from './fixtures.js';
import { comparisonReport } from '../../support/comparison/analyze.js';
import { comparePair } from '../../support/comparison/pair.js';

test('absent engines remain NOT_MEASURED with null paired metrics; no manufactured zero baseline score', () => {
  const result = comparisonReport([capture('viper-engine')], []);
  assert.equal(result.status, 'inconclusive'); assert.equal(result.superiority, 'NOT_ESTABLISHED');
  assert.ok(result.pairs.every(pair => pair.metrics === null));
  for (const row of result.coverage) {
    assert.equal(row.engines['viper-v4']?.status, 'not_measured'); assert.equal(row.engines['hermes']?.passes, null);
  }
  assert.throws(() => comparisonReport([], []));
  assert.throws(() => comparisonReport([capture('hermes'), capture('hermes')], []));
});

test('common subset excludes unsupported cases visibly and retains measured failures', () => {
  const a = capture('hermes'); const b = capture('viper-engine');
  const baseline = { ...a, tasks: [{ ...a.tasks[0]!, status: 'unsupported' as const, reason: 'Unit adapter does not expose this case', trials: [] }, a.tasks[1]!] };
  const candidate = { ...b, tasks: [b.tasks[0]!, { ...b.tasks[1]!, trials: b.tasks[1]!.trials.map(trial => ({ ...trial, passed: false })) }] };
  const pair = comparePair(baseline, candidate, 'cold'); assert.equal(pair.status, 'comparable');
  assert.deepEqual(pair.commonTaskIds, ['case-1']); assert.equal(pair.metrics?.candidate.rubricPassRate, 0);
  assert.equal(pair.metrics?.pairedTaskDelta, -1); assert.equal(pair.metrics?.confidence, null);
  const report = comparisonReport([baseline, candidate], []); assert.equal(report.coverage[0]?.engines['hermes']?.status, 'unsupported');
  assert.equal(report.coverage[1]?.engines['viper-engine']?.status, 'fail');
});

test('model/tool/budget/dataset/environment mismatches refuse metrics rather than comparing unequal conditions', () => {
  const a = capture('hermes'); const b = capture('viper-engine');
  for (const key of ['model', 'tools', 'budget', 'dataset', 'environment'] as const) {
    const changed = { ...b, conditions: { ...b.conditions, [key]: '1'.repeat(64) } };
    const pair = comparePair(a, changed, 'warm'); assert.equal(pair.status, 'incomparable'); assert.equal(pair.metrics, null);
  }
});

test('unequal repeat IDs cannot be cherry-picked into a passing paired subset', () => {
  const a = capture('hermes'); const b = capture('viper-engine');
  const changed = { ...b, tasks: b.tasks.map(task => ({ ...task, trials: task.trials.filter(trial => trial.repeat !== 2) })) };
  const pair = comparePair(a, changed, 'cold'); assert.equal(pair.status, 'inconclusive'); assert.equal(pair.metrics, null);
  assert.ok('excluded' in pair); assert.equal(pair.excluded.length, 2);
});

test('live CI clusters independent tasks, while scripted data never gets a semantic confidence interval', () => {
  const a = capture('hermes'); const b = capture('viper-engine');
  const baseline = { ...a, conditions: { ...a.conditions, generation: 'live' as const }, tasks: a.tasks.map(task => ({ ...task, trials: task.trials.map(trial => ({ ...trial, passed: false })) })) };
  const candidate = { ...b, conditions: { ...b.conditions, generation: 'live' as const } };
  const pair = comparePair(baseline, candidate, 'cold'); assert.equal(pair.metrics?.confidence?.independentTasks, 2);
  assert.equal(pair.metrics?.confidence?.lower, 1); assert.ok('readiness' in pair); assert.equal(pair.readiness.minimum120Tasks, false);
  assert.equal(pair.superiority, 'NOT_ESTABLISHED');
  assert.equal(comparePair(a, b, 'cold').metrics?.confidence, null);
});
