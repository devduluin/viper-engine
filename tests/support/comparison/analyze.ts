import { ENGINE_IDS } from './types.js';
import type { ComparisonEvidence, EngineId } from './types.js';
import { comparePair } from './pair.js';

export interface BaselineReference { readonly engine: EngineId; readonly version: string; readonly reason: string; readonly source: string }
function cell(evidence: ComparisonEvidence | undefined, id: string, reason: string) {
  const task = evidence?.tasks.find(task => task.id === id);
  if (task === undefined) return { status: 'not_measured', reason, trials: 0, passes: null };
  if (task.status !== 'measured') return { status: task.status, reason: task.reason, trials: 0, passes: null };
  return { status: task.trials.every(trial => trial.passed && !trial.criticalFailure) ? 'pass' : 'fail', reason: task.reason,
    trials: task.trials.length, passes: task.trials.filter(trial => trial.passed && !trial.criticalFailure).length };
}
export function comparisonReport(evidence: readonly ComparisonEvidence[], references: readonly BaselineReference[]) {
  if (evidence.length === 0 || new Set(evidence.map(item => item.engine)).size !== evidence.length) throw new Error('Supply distinct engine captures');
  const reason = (id: EngineId) => references.find(item => item.engine === id)?.reason ?? 'No compatible capture supplied';
  const taskIds = [...new Set(evidence.flatMap(item => item.tasks.map(task => task.id)))].sort();
  const capabilities = [...new Set(evidence.flatMap(item => item.capabilities.map(capability => capability.id)))].sort();
  const coverage = taskIds.map(id => ({ id, engines: Object.fromEntries(ENGINE_IDS.map(engine => [engine, cell(evidence.find(item => item.engine === engine), id, reason(engine))])) }));
  const capabilityCoverage = capabilities.map(id => ({ id, engines: Object.fromEntries(ENGINE_IDS.map(engine => {
    const capability = evidence.find(item => item.engine === engine)?.capabilities.find(item => item.id === id);
    return [engine, capability ?? { status: 'not_measured', reason: reason(engine) }];
  })) }));
  const pairs = ENGINE_IDS.flatMap((candidate, index) => ENGINE_IDS.slice(index + 1).flatMap(baseline => ['cold', 'warm'].map(mode => {
    const a = evidence.find(item => item.engine === baseline); const b = evidence.find(item => item.engine === candidate);
    return a === undefined || b === undefined ? { baseline, candidate, mode, status: 'not_measured', commonTaskIds: [], metrics: null,
      reason: 'Both compatible execution captures are required', superiority: 'NOT_ESTABLISHED' } : comparePair(a, b, mode as 'cold' | 'warm');
  })));
  return { schemaVersion: 1, status: pairs.every(pair => pair.status === 'comparable') ? 'comparable' : 'inconclusive',
    coverage, capabilityCoverage, pairs, references, suppliedEngines: evidence.map(item => ({ engine: item.engine, version: item.version, provenance: item.provenance })),
    superiority: 'NOT_ESTABLISHED', disclosure: 'Missing baselines are not failures or zero scores. Capability coverage is separate from the fair common subset.' };
}
