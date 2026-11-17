import { parseId } from '../../../src/contracts/identity/ids.js';
import { parseMessage } from '../../../src/contracts/messages/parse-message.js';
import type { Message } from '../../../src/contracts/messages/message.js';
import type { ModelRequest } from '../../../src/contracts/models/gateway.js';
import { testScope } from '../agent/setup.js';

export const modelUser = parseMessage({ id: 'user', role: 'user', content: [{ type: 'text', text: 'Hello' }] });

export function modelRequest(messages: readonly Message[] = [modelUser], extra: Partial<ModelRequest> = {}): ModelRequest {
  return { scope: testScope(), conversationId: parseId('conversation', 'conversation'), runId: parseId('run', 'run'),
    stepId: parseId('step', 'step'), modelCallId: parseId('model_call', 'model-call'),
    model: 'claude-opus-5-5', maxOutputTokens: 100, messages, tools: [], ...extra };
}
