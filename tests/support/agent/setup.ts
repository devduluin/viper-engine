import { parseId } from '../../../src/contracts/identity/ids.js';
import { scopeFromAuthenticatedIdentity } from '../../../src/contracts/identity/scope.js';
import type { ContextInput } from '../../../src/agent/context/assemble.js';
import { parseMessage } from '../../../src/contracts/messages/parse-message.js';

export function testScope(actor = 'actor-a', app = 'app-a', tenant?: string) {
  return scopeFromAuthenticatedIdentity({
    actorId: parseId('actor', actor), appId: parseId('app', app),
    ...(tenant === undefined ? {} : { tenantId: parseId('tenant', tenant) }),
  });
}

export function testContext(): ContextInput {
  const scope = testScope();
  const conversationId = parseId('conversation', 'conversation-a');
  return {
    scope, conversationId,
    runId: parseId('run', 'run-a'), stepId: parseId('step', 'step-a'),
    modelCallId: parseId('model_call', 'model-a'), model: 'scripted-test', maxOutputTokens: 100,
    tools: [], history: {
      scope, conversationId,
      messages: [parseMessage({ id: 'user-a', role: 'user', content: [{ type: 'text', text: 'Hello' }] })],
    },
    instructions: [parseMessage({ id: 'system-a', role: 'system', content: [{ type: 'text', text: 'Use evidence.' }] })],
  };
}

export function testConnection() {
  return Object.freeze({
    id: parseId('mcp_connection', 'connection-a'), serverId: parseId('mcp_server', 'server-a'),
  });
}
