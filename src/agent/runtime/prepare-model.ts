import { assembleContext } from '../context/assemble.js';
import { prepareContext } from '../context/prepare.js';
import type { StepContext } from './types.js';
import type { ModelCallId, StepId } from '../../contracts/identity/ids.js';

export async function prepareModelContext(context: StepContext, stepId: StepId, modelCallId: ModelCallId) {
  const { input, deps, state } = context;
  const provider = deps.contextEvidence;
  const evidence = provider === undefined ? [] : await context.control.call(signal => provider(
    { scope: input.scope, conversationId: input.conversationId, runId: input.runId }, { signal }));
  const source = { scope: input.scope, conversationId: input.conversationId, runId: input.runId, stepId, modelCallId,
    model: input.model, maxOutputTokens: input.maxOutputTokens, tools: context.index.modelTools,
    history: { ...input.history, messages: state.history }, instructions: input.instructions ?? [], evidence,
    discoveryExchanges: context.discovery.exchanges, deadlineAt: context.control.deadlineAt };
  if (input.context === undefined) return assembleContext(source, deps.model.capabilities, deps.clock.now());
  const prepared = prepareContext(source, deps.model.capabilities, deps.clock.now(), input.context,
    state.contextCheckpoint, input.contextStartMessageId);
  state.contextCheckpoint = prepared.checkpoint;
  return prepared;
}
