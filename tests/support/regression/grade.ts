import { isDeepStrictEqual } from 'node:util';
import type { EngineCase } from './cases.js';
import type { TrialObservation } from './observe.js';
import type { ContentBlock } from '../../../src/contracts/messages/content.js';

function matchesData(content: readonly ContentBlock[], expected: object) {
  return content.some(block => block.type === 'json' && typeof block.data === 'object' && block.data !== null
    && Object.entries(expected).every(([key, value]) => isDeepStrictEqual(Reflect.get(Object(block.data), key), value)));
}
function refusal(content: readonly ContentBlock[], code: string | undefined) {
  if (code === undefined) return true;
  return content.some(block => block.type === 'json' && Reflect.get(Object(Reflect.get(Object(block.data), 'error')), 'code') === code);
}
function privateScopeChecks(statuses: readonly number[]) { return statuses.length === 2 && statuses.every(status => status === 404); }
/** Grade persisted effects/control boundaries, not the scripted model's self-assessment. */
export type GradeObservation = Pick<TrialObservation, 'status' | 'modelCalls' | 'modelAudit' | 'tools' | 'writes' | 'history' | 'checks' | 'usage' | 'approvals' | 'toolCalls'>;
export function gradeTrial(scenario: EngineCase, observed: GradeObservation) {
  const wanted = scenario.expected;
  const lastTool = [...observed.history].reverse().find(message => message.role === 'tool');
  const checks = {
    status: observed.status === wanted.status,
    modelCalls: observed.modelCalls === wanted.modelCalls && observed.modelAudit.length === wanted.modelCalls,
    toolSequence: isDeepStrictEqual(observed.tools, wanted.tools), writes: observed.writes === wanted.writes,
    toolOutcome: wanted.outcome === undefined || lastTool?.outcome === wanted.outcome,
    resultData: wanted.data === undefined || (lastTool !== undefined && matchesData(lastTool.content, wanted.data)),
    foreignAccess: privateScopeChecks(observed.checks.foreignStatuses),
    idempotentStart: observed.checks.sameIdempotentRun, noReplay: observed.checks.idle && observed.checks.noExtraEffects,
    usageAttempts: observed.usage?.modelCalls === wanted.modelCalls,
    exactApproval: exactApproval(scenario, observed),
    finishedModelAudit: observed.modelAudit.every(row => Reflect.get(Object(row), 'outcome') === 'succeeded'),
    refusalCode: refusal(lastTool?.content ?? [], wanted.refusalCode),
  };
  return { passed: Object.values(checks).every(Boolean), checks };
}
function exactApproval(scenario: EngineCase, observed: GradeObservation): boolean {
  if (scenario.control !== 'accept' && scenario.control !== 'reject') return true;
  if (observed.approvals.length !== 1 || observed.toolCalls.length !== 1) return false;
  const approval = observed.approvals[0]!; const call = observed.toolCalls[0]!;
  if (scenario.control === 'reject') return approval.status === 'rejected' && call.attempts === 0;
  const status = scenario.unknownWrite === true ? 'unknown' : 'succeeded';
  return approval.status === 'consumed' && call.attempts === 1 && call.status === status;
}
