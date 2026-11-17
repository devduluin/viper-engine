import { parseId } from '../identity/ids.js';
import { assertTrustedScope } from '../identity/scope.js';
import { parseMessageHistory } from '../messages/history.js';
import { parseJsonObject } from '../messages/json.js';
import type { ModelCallOptions, ModelCapabilities, ModelRequest } from './gateway.js';

function assertTools(request: ModelRequest, capabilities: ModelCapabilities): void {
  if (request.tools.length > 0 && !capabilities.toolCalling) throw new Error('Model does not support tools');
  const names = new Set<string>();
  for (const tool of request.tools) {
    if (tool.name.trim().length === 0 || names.has(tool.name)) throw new Error('Model tool aliases must be nonempty and unique');
    names.add(tool.name);
    parseJsonObject(tool.inputSchema);
  }
}

function assertLimits(request: ModelRequest, now: number): void {
  if (request.model.trim().length === 0) throw new Error('Model identifier is required');
  if (!Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens < 1) throw new Error('Invalid output token limit');
  if (!Number.isFinite(now)) throw new Error('Invalid current instant');
  if (request.deadlineAt !== undefined && (!Number.isFinite(request.deadlineAt) || request.deadlineAt <= now)) {
    throw new Error('Model deadline expired or invalid');
  }
}

export function assertModelCallOptions(capabilities: ModelCapabilities, options: ModelCallOptions = {}): void {
  options.signal?.throwIfAborted();
  if (options.onEvent !== undefined && !capabilities.streaming) throw new Error('Model does not support streaming');
}

/** Validates internal requests; catalog/schema authorization remains application-owned. */
export function assertModelRequest(request: ModelRequest, capabilities: ModelCapabilities, now: number): void {
  assertTrustedScope(request.scope);
  parseId('conversation', request.conversationId);
  parseId('run', request.runId);
  parseId('step', request.stepId);
  parseId('model_call', request.modelCallId);
  assertLimits(request, now);
  const messages = parseMessageHistory(request.messages, { allowPendingToolCalls: false });
  if (messages.length === 0) throw new Error('Model context must not be empty');
  if (messages.some(message => message.content.some(block => !capabilities.contentTypes.includes(block.type)))) {
    throw new Error('Unsupported model content type');
  }
  if (request.responseSchema !== undefined) {
    if (!capabilities.structuredOutput) throw new Error('Model does not support structured output');
    parseJsonObject(request.responseSchema);
  }
  assertTools(request, capabilities);
}
