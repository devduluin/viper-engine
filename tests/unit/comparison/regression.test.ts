import assert from 'node:assert/strict';
import { test } from 'node:test';
import { regressionTrial } from '../../support/comparison/regression-raw.js';

test('regression import refuses forged grade flags, missing controls, mismatched audit and trial bindings', () => {
  const checks = { status: true, modelCalls: true, toolSequence: true, writes: true, toolOutcome: true, resultData: true,
    foreignAccess: true, idempotentStart: true, noReplay: true, usageAttempts: true, exactApproval: true, finishedModelAudit: true, refusalCode: true };
  const observed = { caseId: 'ER-001', repeat: 0, mode: 'cold', modelCalls: 1, tools: [], modelAudit: [{}], localMs: 10 };
  const raw = { observed, grade: { passed: true, checks } }; const record = { ...observed, toolCalls: 0, passed: true };
  assert.equal(regressionTrial(raw, record).passed, true);
  assert.throws(() => regressionTrial({ ...raw, grade: { passed: true, checks: {} } }, record), /Incomplete/);
  assert.throws(() => regressionTrial({ ...raw, grade: { passed: true, checks: { ...checks, foreignAccess: false } } }, record), /disagreement/);
  assert.throws(() => regressionTrial(raw, { ...record, modelCalls: 2 }), /audit/);
  assert.throws(() => regressionTrial(raw, { ...record, repeat: 1 }), /binding/);
  const failed = regressionTrial({ ...raw, grade: { passed: false, checks: { ...checks, status: false } } }, { ...record, passed: false });
  assert.equal(failed.passed, false, 'measured failure stays in the common subset');
});
