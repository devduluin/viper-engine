import type { TrialRecord } from './trials.js';
import { latency, usageTotals } from './metrics.js';
import { engineCases } from './cases.js';
import { CRITICAL_COVERAGE } from './coverage.js';
import type { runSuite } from './suites.js';

function metrics(records: readonly TrialRecord[]) {
  const measured = records.flatMap(record => record.localMs === undefined ? [] : [record.localMs]);
  return { trials: records.length, passed: records.filter(record => record.passed).length,
    latency: latency(measured), usage: usageTotals(records.map(record => record.usage)),
    toolCalls: records.reduce((sum, record) => sum + (record.toolCalls ?? 0), 0),
    catalogPages: records.reduce((sum, record) => sum + (record.catalogPages ?? 0), 0) };
}
function completeTrials(records: readonly TrialRecord[], repeats: number, mode: 'offline' | 'postgres', ids = engineCases().map(scenario => scenario.id)) {
  const expected = mode === 'offline' ? [] : ids.flatMap(id => Array.from({ length: repeats }, (_, repeat) =>
    ['cold', 'warm'].map(temperature => `${id}/${repeat}/${temperature}`)).flat());
  const actual = records.map(record => `${record.caseId}/${record.repeat}/${record.mode}`);
  return expected.length === actual.length && new Set(actual).size === expected.length && actual.every(key => expected.includes(key));
}
function casePassed(records: readonly TrialRecord[], id: string, repeats: number) {
  const own = records.filter(record => record.caseId === id);
  return completeTrials(own, repeats, 'postgres', [id]) && own.every(record => record.passed);
}
function completeSuites(suites: readonly ReturnType<typeof runSuite>[], mode: 'offline' | 'postgres') {
  const expected = mode === 'offline' ? ['unit', 'contract'] : ['unit', 'contract', 'integration'];
  return suites.length === expected.length && new Set(suites.map(suite => suite.suite)).size === expected.length
    && expected.every(name => suites.some(suite => suite.suite === name && suite.passed));
}
export function regressionResults(suites: readonly ReturnType<typeof runSuite>[], records: readonly TrialRecord[], mode: 'offline' | 'postgres', repeats: number) {
  const integration = suites.find(suite => suite.suite === 'integration');
  const critical = CRITICAL_COVERAGE.map(group => ({ ...group,
    status: integration === undefined ? 'NOT_RUN' : integration.passed && group.files.every(file => integration.files.includes(file)) ? 'PASS' : 'FAIL' }));
  const expectedTrials = mode === 'postgres' ? engineCases().length * repeats * 2 : 0;
  return { passed: completeSuites(suites, mode) && completeTrials(records, repeats, mode) && records.every(record => record.passed)
      && (mode === 'offline' || critical.every(group => group.status === 'PASS')),
    suites, critical, expectedTrials, actualTrials: records.length,
    cold: metrics(records.filter(record => record.mode === 'cold')), warm: metrics(records.filter(record => record.mode === 'warm')),
    perCase: engineCases().map(scenario => ({ id: scenario.id, family: scenario.family,
      status: mode === 'offline' ? 'NOT_RUN' : casePassed(records, scenario.id, repeats) ? 'PASS' : 'FAIL',
      cold: metrics(records.filter(record => record.caseId === scenario.id && record.mode === 'cold')),
      warm: metrics(records.filter(record => record.caseId === scenario.id && record.mode === 'warm')) })),
    semanticQuality: 'NOT_MEASURED', comparison: 'V4/Hermes NOT_MEASURED', records };
}
