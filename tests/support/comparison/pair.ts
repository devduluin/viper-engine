import { isDeepStrictEqual } from 'node:util';
import type { ComparisonEvidence, ComparisonTask } from './types.js';
import { pairedInterval, ratio, trialMetrics } from './statistics.js';

function trialKeys(task: ComparisonTask, mode: 'cold' | 'warm') {
  return task.trials.filter(trial => trial.mode === mode).map(trial => trial.repeat).sort((a, b) => a - b);
}
function matchingTasks(left: ComparisonEvidence, right: ComparisonEvidence, mode: 'cold' | 'warm') {
  const ids = [...new Set([...left.tasks, ...right.tasks].map(task => task.id))].sort();
  const common: { id: string; left: ComparisonTask; right: ComparisonTask }[] = []; const excluded: { id: string; reason: string }[] = [];
  for (const id of ids) {
    const a = left.tasks.find(task => task.id === id); const b = right.tasks.find(task => task.id === id);
    if (a?.status !== 'measured' || b?.status !== 'measured') { excluded.push({ id, reason: 'At least one participant is missing/unmeasured/unsupported' }); continue; }
    if (a.family !== b.family || a.split !== b.split) { excluded.push({ id, reason: 'Task family/split mismatch' }); continue; }
    const keys = trialKeys(a, mode);
    if (keys.length === 0 || !isDeepStrictEqual(keys, trialKeys(b, mode))) { excluded.push({ id, reason: 'Trial count/repeat IDs differ; no cherry-picked intersection' }); continue; }
    common.push({ id, left: a, right: b });
  }
  return { common, excluded };
}
function taskRate(task: ComparisonTask, mode: 'cold' | 'warm') {
  const trials = task.trials.filter(trial => trial.mode === mode); return trials.filter(trial => trial.passed).length / trials.length;
}
export function comparePair(left: ComparisonEvidence, right: ComparisonEvidence, mode: 'cold' | 'warm') {
  const differences = (Object.keys(left.conditions) as (keyof typeof left.conditions)[]).filter(key => left.conditions[key] !== right.conditions[key]);
  const names = { baseline: left.engine, candidate: right.engine, mode };
  if (differences.length > 0) return { ...names, status: 'incomparable' as const, conditionDifferences: differences, commonTaskIds: [], metrics: null, superiority: 'NOT_ESTABLISHED' };
  const { common, excluded } = matchingTasks(left, right, mode);
  if (common.length === 0) return { ...names, status: 'inconclusive' as const, commonTaskIds: [], excluded, metrics: null, superiority: 'NOT_ESTABLISHED' };
  const a = trialMetrics(common.flatMap(task => task.left.trials.filter(trial => trial.mode === mode)));
  const b = trialMetrics(common.flatMap(task => task.right.trials.filter(trial => trial.mode === mode)));
  const deltas = common.map(task => taskRate(task.right, mode) - taskRate(task.left, mode));
  const mean = (side: 'left' | 'right') => common.reduce((sum, task) => sum + taskRate(task[side], mode), 0) / common.length;
  const live = left.conditions.generation === 'live';
  const confidence = live ? pairedInterval(deltas) : null;
  return { ...names, status: 'comparable' as const, commonTaskIds: common.map(task => task.id), excluded,
    metrics: { baseline: a, candidate: b, baselineTaskMean: mean('left'), candidateTaskMean: mean('right'),
      pairedTaskDelta: deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length, confidence,
      p95Ratio: ratio(b.latency.p95Ms, a.latency.p95Ms), billedCostPerPassRatio: ratio(b.billedCostPerPassingTrialUsd, a.billedCostPerPassingTrialUsd) },
    readiness: { independentTasks: common.length, holdoutTasks: common.filter(task => task.left.split === 'holdout').length,
      minimum120Tasks: common.length >= 120, minimum30Holdouts: common.filter(task => task.left.split === 'holdout').length >= 30,
      minimum3TrialsEach: common.every(task => trialKeys(task.left, mode).length >= 3), liveModel: live,
      noCandidateCriticalFailures: b.criticalFailures === 0 && right.capabilities.every(item => item.status !== 'fail') },
    superiority: 'NOT_ESTABLISHED', reviewRequired: true,
    interpretation: live ? 'Paired task descriptive statistics; sample/split/safety/cost/effect gates and human review still required.' : 'Scripted rubric preservation only; no semantic-quality confidence interval or superiority claim.' };
}
