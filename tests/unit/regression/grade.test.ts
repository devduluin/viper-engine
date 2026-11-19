import assert from 'node:assert/strict';
import { test } from 'node:test';
import { engineCases } from '../../support/regression/cases.js';
import { gradeTrial } from '../../support/regression/grade.js';
import type { GradeObservation } from '../../support/regression/grade.js';
import { regressionResults } from '../../support/regression/report.js';
import type { runSuite } from '../../support/regression/suites.js';
import type { TrialRecord } from '../../support/regression/trials.js';

function finalObservation(): GradeObservation {
  return { status: 'completed', modelCalls: 1, modelAudit: [{ outcome: 'succeeded' }], tools: [], writes: 0, history: [], toolCalls: [], approvals: [],
    usage: { modelCalls: 1, source: 'unavailable', inputTokens: null, outputTokens: null, totalTokens: null },
    checks: { foreignStatuses: [404, 404], sameIdempotentRun: true, idle: true, noExtraEffects: true } };
}
test('grades cannot pass a success claim with missing audit, leaked scope or extra effect', () => {
  const scenario = engineCases()[0]!; const base = finalObservation(); assert.ok(gradeTrial(scenario, base).passed);
  for (const changed of [{ status: 'failed' as const }, { modelAudit: [] }, { writes: 1 },
    { checks: { ...base.checks, foreignStatuses: [200, 404] } }, { checks: { ...base.checks, foreignStatuses: [] } },
    { checks: { ...base.checks, noExtraEffects: false } }]) {
    assert.equal(gradeTrial(scenario, { ...base, ...changed }).passed, false);
  }
});
test('an aggregate report cannot silently pass missing suite or missing engine/critical evidence', () => {
  assert.equal(regressionResults([], [], 'offline', 1).passed, false);
  const suite = (name: 'unit' | 'contract'): ReturnType<typeof runSuite> => ({ suite: name, passed: true, localMs: 0, exitCode: 0, signal: null,
    counts: { tests: 1, passed: 1, failed: 0, skipped: 0, cancelled: 0 }, files: [], rawFile: 'test.tap' });
  assert.equal(regressionResults([suite('unit'), suite('unit')], [], 'offline', 1).passed, false);
  assert.equal(regressionResults([suite('unit'), suite('contract')], [], 'offline', 1).passed, true);
  const postgres = regressionResults([suite('unit'), suite('contract')], [], 'postgres', 1);
  assert.equal(postgres.passed, false); assert.ok(postgres.perCase.every(item => item.status === 'FAIL'));
  assert.ok(postgres.critical.every(group => group.status === 'NOT_RUN'));
  const duplicate: TrialRecord = { caseId: 'ER-001', repeat: 0, mode: 'cold', passed: true, rawFile: 'fake.json' };
  const incomplete = regressionResults([suite('unit'), suite('contract')], [duplicate, duplicate], 'postgres', 1);
  assert.equal(incomplete.perCase[0]?.status, 'FAIL');
});
