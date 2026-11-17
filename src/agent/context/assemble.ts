import type { TrustedScope } from '../../contracts/identity/scope.js';
import { assertSameScope } from '../../contracts/identity/scope.js';
import type { ConversationId } from '../../contracts/identity/ids.js';
import type { Message } from '../../contracts/messages/message.js';
import { parseMessageHistory } from '../../contracts/messages/history.js';
import { parseJsonObject } from '../../contracts/messages/json.js';
import type { ModelCapabilities, ModelRequest } from '../../contracts/models/gateway.js';
import { assertModelRequest } from '../../contracts/models/request-validation.js';
import { estimateContextText } from './estimate.js';
import type { ContextTextEstimate } from './estimate.js';

/** Loaded by trusted application storage; never authenticate an ingress history with this type. */
export interface ScopedHistory {
  readonly scope: TrustedScope;
  readonly conversationId: ConversationId;
  readonly messages: readonly Message[];
}

export interface ContextInput extends Omit<ModelRequest, 'messages'> {
  readonly history: ScopedHistory;
  /** Application-owned instructions only. Persisted history cannot introduce system messages. */
  readonly instructions?: readonly Message[];
  /** Retrieved data is user-role evidence, never host instructions or persisted conversation history. */
  readonly evidence?: readonly Message[];
}

export interface AssembledContext {
  readonly request: ModelRequest;
  readonly estimate: ContextTextEstimate;
}

/** Complete immutable snapshot; no implicit truncation, clock, tool discovery or permission grants. */
export function assembleContext(input: ContextInput, capabilities: ModelCapabilities, now: number): AssembledContext {
  assertSameScope(input.scope, input.history.scope);
  if (input.conversationId !== input.history.conversationId) throw new Error('Conversation context mismatch');
  const instructions = input.instructions ?? [];
  if (instructions.some(message => message.role !== 'system')) throw new Error('Instructions require system role');
  if (input.history.messages.some(message => message.role === 'system')) {
    throw new Error('History cannot supply system instructions');
  }
  const messages = parseMessageHistory([...instructions, ...evidence(input.evidence ?? []), ...input.history.messages], { allowPendingToolCalls: false });
  const tools = Object.freeze(input.tools.map(tool => Object.freeze({
    name: tool.name, inputSchema: parseJsonObject(tool.inputSchema),
    ...(tool.description === undefined ? {} : { description: tool.description }),
  })));
  const request: ModelRequest = Object.freeze({
    scope: input.scope, conversationId: input.conversationId, runId: input.runId,
    stepId: input.stepId, modelCallId: input.modelCallId, model: input.model,
    maxOutputTokens: input.maxOutputTokens, messages, tools,
    ...(input.deadlineAt === undefined ? {} : { deadlineAt: input.deadlineAt }),
    ...(input.responseSchema === undefined ? {} : { responseSchema: parseJsonObject(input.responseSchema) }),
  });
  assertModelRequest(request, capabilities, now);
  return Object.freeze({ request, estimate: estimateContextText(request) });
}

function evidence(messages: readonly Message[]): readonly Message[] {
  if (messages.length > 10 || messages.some(message => message.role !== 'user')) throw new Error('Recall evidence must be bounded user-role data');
  if (new TextEncoder().encode(JSON.stringify(messages)).byteLength > 32768) throw new RangeError('Recall evidence exceeds byte limit');
  return messages;
}
