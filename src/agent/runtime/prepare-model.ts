import { assembleContext } from '../context/assemble.js';
import { prepareContext } from '../context/prepare.js';
import type { StepContext } from './types.js';
import { clientToolDefinitions } from './client-tools.js';
import type { ModelCallId, StepId } from '../../contracts/identity/ids.js';
import { MEMORY_TOOLS } from './memory-definitions.js';
import { agentToolDefinitions } from './agent-definitions.js';
import { outputAllowance, recoveryInstructions } from './recovery.js';

export async function prepareModelContext(context: StepContext, stepId: StepId, modelCallId: ModelCallId) {
  const { input, deps, state } = context;
  const provider = deps.contextEvidence;
  const evidence = provider === undefined ? [] : await context.control.call(signal => provider(
    { scope: input.scope, conversationId: input.conversationId, runId: input.runId }, { signal }));
  const source = { scope: input.scope, conversationId: input.conversationId, runId: input.runId, stepId, modelCallId,
    model: input.model, maxOutputTokens: outputAllowance(context),
    tools: [...context.index.modelTools, ...await clientToolDefinitions(context), ...(deps.userMemory === undefined ? [] : MEMORY_TOOLS),
      ...(deps.agents === undefined ? [] : agentToolDefinitions(deps.agents.profiles))],
    history: { ...input.history, messages: state.history }, instructions: [...(input.instructions ?? []), ...recoveryInstructions(context)], evidence,
    discoveryExchanges: context.discovery.exchanges, deadlineAt: context.control.deadlineAt };
  if (input.context === undefined) return assembleContext(source, deps.model.capabilities, deps.clock.now());
  const prepared = prepareContext(source, deps.model.capabilities, deps.clock.now(), input.context,
    state.contextCheckpoint, input.contextStartMessageId);
  state.contextCheckpoint = prepared.checkpoint;
  return prepared;
}
