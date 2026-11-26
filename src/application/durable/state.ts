import { parseJsonObject } from '../../contracts/messages/json.js';
import type { JsonObject } from '../../contracts/messages/json.js';
import { parseId } from '../../contracts/identity/ids.js';
import type { ModelCallId, StepId } from '../../contracts/identity/ids.js';
import type { RunLoopInput } from '../../agent/runtime/types.js';
import type { ToolCallReport } from '../../agent/execution/dispatch.js';
import { parseBudgetState } from '../../agent/policies/budget-state.js';
import type { BudgetState } from '../../agent/policies/budget-state.js';
import { resolveRunLimits } from '../../agent/policies/limits.js';
import type { RunLimits } from '../../agent/policies/limits.js';
import { parseToolFailureCode } from '../../contracts/state/tool-rejection.js';
import { savedContext } from './context-state.js';
import type { DurableContextState } from './context-state.js';
import { resolveContextBudget } from '../../contracts/context/budget.js';
import { parseToolDiscoveryState } from '../../contracts/discovery/state.js';
import type { ToolDiscoveryState } from '../../contracts/discovery/state.js';

export interface DurableState extends DurableContextState {
  /** Stable first message of the model history for this run. Null marks an initially empty history. */
  historyWindowFirst?: string | null;
  toolDiscovery?: ToolDiscoveryState;
  version: 1;
  phase: 'model' | 'calls' | 'correction' | 'input' | 'final';
  model: string; provider?: string; maxModelCalls: number; maxOutputTokens: number; limits: RunLimits; deadlineAt: number;
  budget: BudgetState; modelCalls: number; reports: ToolCallReport[]; stepIndex: number;
  stepId?: StepId; modelCallId?: ModelCallId; modelPending: boolean;
}

function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid saved counter');
  return value;
}

function text(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error('Invalid saved text');
  return value;
}

function failureCode(value: unknown, status: ToolCallReport['status']) {
  const code = parseToolFailureCode(value);
  if (code === 'rejected_by_user' && status !== 'rejected') throw new Error('User rejection requires a rejected report');
  return code;
}

function positive(value: unknown): number {
  const parsed = number(value);
  if (parsed < 1) throw new Error('Saved ceiling must be positive');
  return parsed;
}

const STATUSES = ['succeeded', 'failed', 'unknown', 'rejected', 'cancelled', 'awaiting_approval', 'deferred'] as const;
const PHASES = ['model', 'calls', 'correction', 'input', 'final'] as const;
function member<T extends string>(value: unknown, choices: readonly T[]): T {
  const found = choices.find(choice => choice === value);
  if (found === undefined) throw new Error('Invalid saved enum');
  return found;
}

export function encodeState(state: DurableState): JsonObject {
  return parseJsonObject(JSON.parse(JSON.stringify(state)));
}

export function decodeState(value: JsonObject): DurableState {
  if (value['version'] !== 1 || !Array.isArray(value['reports']) || typeof value['modelPending'] !== 'boolean') throw new Error('Invalid durable state version');
  const reports = value['reports'].map(item => {
    const report = parseJsonObject(item);
    const status = member(report['status'], STATUSES);
    return { id: parseId('tool_call', report['id']), name: text(report['name']), status,
      ...(report['failureCode'] === undefined ? {} : { failureCode: failureCode(report['failureCode'], status) }) };
  });
  return { version: 1, phase: member(value['phase'], PHASES), model: text(value['model']),
    ...(value['historyWindowFirst'] === undefined ? {} : { historyWindowFirst: value['historyWindowFirst'] === null ? null : text(value['historyWindowFirst']) }),
    ...(value['provider'] === undefined ? {} : { provider: text(value['provider']) }),
    maxModelCalls: positive(value['maxModelCalls']), maxOutputTokens: positive(value['maxOutputTokens']),
    limits: resolveRunLimits(parseJsonObject(value['limits'])), deadlineAt: number(value['deadlineAt']),
    budget: parseBudgetState(value['budget']), modelCalls: number(value['modelCalls']), reports,
    stepIndex: number(value['stepIndex']), modelPending: value['modelPending'],
    ...(value['stepId'] === undefined ? {} : { stepId: parseId('step', value['stepId']) }),
    ...(value['modelCallId'] === undefined ? {} : { modelCallId: parseId('model_call', value['modelCallId']) }), ...savedContext(value),
    ...(value['toolDiscovery'] === undefined ? {} : { toolDiscovery: parseToolDiscoveryState(value['toolDiscovery']) }),
  };
}

export function initialState(plan: Pick<RunLoopInput, 'model' | 'maxModelCalls' | 'maxOutputTokens' | 'limits' | 'deadlineAt' | 'context'>, now: number): DurableState {
  const limits = resolveRunLimits(plan.limits);
  return { version: 1, phase: 'model', model: text(plan.model), maxModelCalls: positive(plan.maxModelCalls),
    maxOutputTokens: positive(plan.maxOutputTokens), limits, deadlineAt: Math.min(now + limits.maxDurationMs, plan.deadlineAt ?? Infinity),
    budget: { steps: 0, toolCalls: 0, corrections: 0, modelOutputBytes: 0, toolOutputBytes: 0, repeated: [], calls: [], uncertain: [] },
    modelCalls: 0, reports: [], stepIndex: 0, modelPending: false,
    ...(plan.context === undefined ? {} : { contextBudget: resolveContextBudget(plan.context) }) };
}
