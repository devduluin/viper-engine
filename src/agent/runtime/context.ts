import { parseMessageHistory } from '../../contracts/messages/history.js';
import { ToolDiscovery } from '../discovery/controller.js';
import { RunBudget } from '../policies/budget.js';
import { RunControl } from '../policies/control.js';
import { resolveRunLimits } from '../policies/limits.js';
import type { StepContext } from './model-step.js';
import type { RunLoopDependencies, RunLoopInput } from './types.js';
import { resolveContextBudget } from '../../contracts/context/budget.js';
import { parseContextCheckpoint } from '../../contracts/context/parse-checkpoint.js';
import { assertContextCheckpoint } from '../context/checkpoint.js';

function contextState(input: RunLoopInput) {
  const saved = input.resume?.contextCheckpoint;
  if (saved === undefined) return {};
  const checkpoint = parseContextCheckpoint(saved);
  if (input.context === undefined) throw new Error('Context checkpoint requires its budget');
  assertContextCheckpoint(input, checkpoint, resolveContextBudget(input.context));
  return { contextCheckpoint: checkpoint };
}

function discoveryFor(input: RunLoopInput) {
  const legacy = input.resume !== undefined && input.resume.modelCalls > 0 && input.resume.toolDiscovery === undefined;
  const discovery = new ToolDiscovery(input.tools, input.scope, input.runId, legacy ? { mode: 'off' } : input.toolDiscovery, input.resume?.toolDiscovery);
  if (discovery.exchanges.some(exchange => !input.history.messages.some(message => message.id === exchange.afterMessageId))) throw new Error('Discovery anchor missing');
  return discovery;
}

/** Server-owned working context; never reconstruct this object from client JSON. */
export function createLoopContext(input: RunLoopInput, deps: RunLoopDependencies): StepContext {
  if (!Number.isSafeInteger(input.maxModelCalls) || input.maxModelCalls < 1) {
    throw new RangeError('maxModelCalls must be a positive safe integer');
  }
  input = Object.freeze({ ...input, history: Object.freeze({ ...input.history,
    messages: parseMessageHistory(input.history.messages),
  }), instructions: parseMessageHistory(input.instructions ?? []),
    ...(input.context === undefined ? {} : { context: resolveContextBudget(input.context) }) });
  const limits = resolveRunLimits(input.limits);
  const discovery = discoveryFor(input);
  const context = contextState(input);
  return {
    input, deps, index: discovery.index, discovery,
    control: new RunControl(deps.clock, limits.maxDurationMs, input.deadlineAt, input.signal),
    state: { history: [...input.history.messages], appended: [], reports: [...(input.resume?.reports ?? [])], modelCalls: input.resume?.modelCalls ?? 0,
      ...context },
    budget: new RunBudget(limits, input.scope, input.runId, input.resume?.budget),
    emit: async event => { await deps.onEvent?.(Object.freeze(event)); },
  };
}
