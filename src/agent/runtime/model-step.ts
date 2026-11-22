import type { AssistantMessage, Message } from '../../contracts/messages/message.js';
import { parseMessage } from '../../contracts/messages/parse-message.js';
import type { ModelDecision } from '../../contracts/models/decision.js';
import type { ModelFailure, ModelRequest } from '../../contracts/models/gateway.js';
import { parseModelDecision } from '../../contracts/models/decision.js';
import { parseModelUsage } from '../../contracts/models/usage.js';
import { prepareModelContext } from './prepare-model.js';
import type { StepContext } from './types.js';
import { RunInterrupted } from '../policies/control.js';
import { BudgetExceeded } from '../policies/limits.js';
import { TOOL_SEARCH_NAME } from '../../contracts/discovery/state.js';
import { withDiscoveryExchanges } from '../context/transient.js';
import { isClientToolName } from './client-tools.js';
import { isMemoryTool } from './memory-definitions.js';
import { outputAllowance } from './recovery.js';

export type ModelStep =
  | { readonly kind: 'memory'; readonly assistant: AssistantMessage; readonly calls: readonly import('../../contracts/messages/message.js').ToolCall[] }
  | { readonly kind: 'client'; readonly assistant: AssistantMessage; readonly calls: readonly import('../../contracts/messages/message.js').ToolCall[] }
  | { readonly kind: 'discovery'; readonly assistant: AssistantMessage; readonly call: import('../../contracts/messages/message.js').ToolCall }
  | { readonly kind: 'decision'; readonly decision: ModelDecision; readonly assistant: AssistantMessage }
  | { readonly kind: 'failure'; readonly failure: ModelFailure }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'cancelled' };

export type { StepContext } from './types.js';

function knownCallIds(history: readonly Message[]): Set<string> {
  return new Set(history.flatMap(message => message.role === 'assistant' ? (message.toolCalls ?? []).map(call => call.id) : []));
}

/** Assistant message for the decision, or undefined when it reuses a call ID already in history. */
function assistantMessage(context: StepContext, decision: ModelDecision): AssistantMessage | undefined {
  if (decision.kind === 'tool_calls') {
    const known = knownCallIds(withDiscoveryExchanges(context.state.history, context.discovery.exchanges));
    if (decision.calls.some(call => known.has(call.id))) return undefined;
  }
  const content = decision.kind === 'needs_input' ? [{ type: 'text', text: decision.question }] : decision.content;
  const message = parseMessage({
    id: context.deps.ids.next('message'), role: 'assistant', content,
    ...(decision.kind === 'tool_calls' ? { toolCalls: decision.calls } : {}),
  });
  return message.role === 'assistant' ? message : undefined;
}

async function generate(context: StepContext, request: ModelRequest) {
  return context.control.call(signal => context.deps.model.generate(request, { signal }));
}

/** One model call over the complete current history. Unexpected gateway faults propagate. */
export async function requestDecision(context: StepContext): Promise<ModelStep> {
  const { deps, state } = context;
  if (state.history.some(message => message.content.some(block => !deps.model.capabilities.contentTypes.includes(block.type)))) {
    return { kind: 'failure', failure: { code: 'unsupported', message: 'Model does not support content retained in this conversation', retryable: false } };
  }
  const stepId = deps.ids.next('step');
  const modelCallId = deps.ids.next('model_call');
  const prepared = await prepareModelContext(context, stepId, modelCallId);
  const reservation = context.budget.tokens.reserve(prepared.estimate.tokens, outputAllowance(context), prepared.estimate.hasUnpricedMedia);
  const request = Object.freeze({ ...prepared.request, maxOutputTokens: reservation.output });
  await context.emit({ type: 'model_call_started', stepId, modelCallId,
    ...(state.contextCheckpoint === undefined ? {} : { contextCheckpoint: state.contextCheckpoint }) });
  const result = await generate(context, request);
  const limit = context.budget.output('model', result);
  const usage = parseModelUsage(result.usage);
  context.budget.tokens.settle(reservation.reserved, usage);
  await context.emit({ type: 'model_call_finished', modelCallId, ok: result.ok, usage,
    ...(result.ok ? {} : { failureCode: result.error.code }) });
  const stopped = context.control.check();
  if (stopped !== undefined) throw new RunInterrupted(stopped);
  if (limit !== undefined) throw new BudgetExceeded(limit);
  context.budget.tokens.assertAvailable();
  if (usage.source === 'provider' && usage.outputTokens !== null && usage.outputTokens > reservation.output) {
    throw new BudgetExceeded('model_output_limit');
  }
  if (!result.ok) return { kind: 'failure', failure: result.error };
  return normalizeDecision(context, result.decision);
}

function normalizeDecision(context: StepContext, value: unknown): ModelStep {
  let decision: ModelDecision;
  try { decision = parseModelDecision(value); } catch { return { kind: 'invalid' }; }
  const assistant = assistantMessage(context, decision);
  if (assistant === undefined) return { kind: 'invalid' };
  const special = specialStep(context, decision, assistant);
  if (special !== undefined) return special;
  if (decision.kind === 'tool_calls') context.budget.propose(decision.calls, context.index);
  return { kind: 'decision', decision, assistant };
}

/** Tool search (discovery) or client tools: steps handled outside MCP dispatch. */
function specialStep(context: StepContext, decision: ModelDecision, assistant: AssistantMessage): ModelStep | undefined {
  if (decision.kind !== 'tool_calls') return undefined;
  if (decision.calls.some(call => isMemoryTool(call.name))) {
    context.budget.propose(decision.calls, context.index);
    return { kind: 'memory', assistant, calls: decision.calls };
  }
  if (context.discovery.enabled && decision.calls.some(call => call.name === TOOL_SEARCH_NAME)) {
    if (decision.calls.length !== 1 || decision.calls[0]?.name !== TOOL_SEARCH_NAME) return { kind: 'invalid' };
    return { kind: 'discovery', assistant, call: decision.calls[0] };
  }
  if (decision.calls.some(call => isClientToolName(call.name))) return { kind: 'client', assistant, calls: decision.calls };
  return undefined;
}
