import type { JsonObject } from '../../../src/contracts/messages/json.js';
import type { ComparisonTrial } from './types.js';
import { array, integer, member, object } from './validation.js';

const CHECKS = ['status', 'modelCalls', 'toolSequence', 'writes', 'toolOutcome', 'resultData', 'foreignAccess',
  'idempotentStart', 'noReplay', 'usageAttempts', 'exactApproval', 'finishedModelAudit', 'refusalCode'];
/** Preserve failed grades; refuse omitted/malformed checks instead of trusting a summary pass bit. */
function grading(raw: JsonObject, record: JsonObject) {
  const grade = object(raw['grade']); const checks = object(grade['checks']);
  if (CHECKS.some(key => typeof checks[key] !== 'boolean') || Object.keys(checks).length !== CHECKS.length) throw new Error('Incomplete regression grading evidence');
  const passed = CHECKS.every(key => checks[key] === true);
  if (grade['passed'] !== passed || record['passed'] !== passed) throw new Error('Regression grade/record disagreement');
  return { passed, criticalFailure: ['foreignAccess', 'noReplay', 'exactApproval'].some(key => checks[key] !== true) };
}
function measures(observed: JsonObject, record: JsonObject) {
  const modelCalls = integer(observed['modelCalls']); const tools = array(observed['tools']);
  if (array(observed['modelAudit']).length !== modelCalls || record['modelCalls'] !== modelCalls || record['toolCalls'] !== tools.length) throw new Error('Regression audit/metrics disagreement');
  if (['caseId', 'repeat', 'mode'].some(key => observed[key] !== record[key])) throw new Error('Regression raw trial binding mismatch');
  const duration = observed['localMs'];
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0 || record['localMs'] !== duration) throw new Error('Invalid regression timing');
  return { latencyMs: duration, modelCalls, toolCalls: tools.length };
}
export function regressionTrial(raw: JsonObject, record: JsonObject): ComparisonTrial {
  const observed = object(raw['observed']);
  return { repeat: integer(observed['repeat']), mode: member(observed['mode'], ['cold', 'warm']), ...grading(raw, record),
    ...measures(observed, record), costUsd: null, costProvenance: 'unavailable' };
}
