import type { ContextBudget } from '../../contracts/context/budget.js';
import { resolveContextBudget } from '../../contracts/context/budget.js';
import type { ContextCheckpoint } from '../../contracts/context/checkpoint.js';
import { parseContextCheckpoint } from '../../contracts/context/parse-checkpoint.js';
import { parseJsonObject } from '../../contracts/messages/json.js';
import type { JsonObject } from '../../contracts/messages/json.js';
import type { RunCheckpoint } from '../../contracts/state/checkpoints.js';
import type { RunLoopInput } from '../../agent/runtime/types.js';
import type { ToolDiscoveryState } from '../../contracts/discovery/state.js';

export interface DurableContextState { contextBudget?: ContextBudget; contextCheckpoint?: ContextCheckpoint; toolDiscovery?: ToolDiscoveryState }
export function savedContext(value: JsonObject): DurableContextState {
  return { ...(value['contextBudget'] === undefined ? {} : { contextBudget: resolveContextBudget(parseJsonObject(value['contextBudget'])) }),
    ...(value['contextCheckpoint'] === undefined ? {} : { contextCheckpoint: parseContextCheckpoint(value['contextCheckpoint']) }) };
}
export function contextPlan(state: DurableContextState, plan: Pick<RunLoopInput, 'context'>, cp: RunCheckpoint, cancelled = false) {
  if (cancelled) { delete state.contextBudget; delete state.contextCheckpoint; return {}; }
  if (state.contextBudget === undefined && plan.context !== undefined) state.contextBudget = resolveContextBudget(plan.context);
  const first = contextAnchor(state, cp);
  return { ...(state.contextBudget === undefined ? {} : { context: state.contextBudget }),
    ...(first === undefined ? {} : { contextStartMessageId: first }) };
}
function contextAnchor(state: DurableContextState, cp: RunCheckpoint) {
  if (state.contextCheckpoint !== undefined) return state.contextCheckpoint.preserveFromMessageId;
  const ids = new Set(cp.runMessageIds); const index = cp.history.findIndex(message => ids.has(message.id));
  if (index < 0) return undefined;
  return [...cp.history.slice(0, index + 1)].reverse().find(message => message.role === 'user')?.id ?? cp.history[index]?.id;
}
export function resumeContext(state: DurableContextState) {
  return { ...(state.contextCheckpoint === undefined ? {} : { contextCheckpoint: state.contextCheckpoint }),
    ...(state.toolDiscovery === undefined ? {} : { toolDiscovery: state.toolDiscovery }) };
}
