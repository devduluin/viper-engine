export const now = 1_800_000_000_000;
export const content = [{ type: 'text', text: 'Get stock for item-1' }];
export const tool = { connectionId: 'connection-1', serverId: 'server-1', name: 'lookup_item', definitionVersion: 'v1' };
export const proposal = { runId: 'run-1', toolCallId: 'call-1', tool, argumentsDigest: 'a'.repeat(64) };
export const approval = { schemaVersion: 1, approvalId: 'approval-1', revision: 1,
  status: 'pending', proposal, arguments: {}, expiresAt: now + 60_000 };
export const connection = { schemaVersion: 1, connectionId: 'connection-1', serverId: 'server-1',
  revision: 1, authState: 'ready', createdAt: now, updatedAt: now };
export const finalMessage = { id: 'message-final', role: 'assistant', content: [{ type: 'text', text: 'Stock: 5' }] };
export const run = { schemaVersion: 1, runId: 'run-1', conversationId: 'conversation-1', status: 'running',
  revision: 3, createdAt: now, updatedAt: now, eventCursor: 'opaque_cursor_3', lastEventSequence: 3 };
export const reason = { code: 'OUTCOME_UNKNOWN', message: 'Reconciliation required' };

export const requestFixtures = {
  CreateConversation: { title: 'Stock query' },
  StartRun: { input: { content }, context: { resources: [{ connectionId: 'connection-1', uri: 'fixture://policy' }],
    prompts: [{ connectionId: 'connection-1', name: 'summarize_item', arguments: { id: 'item-1' } }],
  } },
  SubmitInput: { inputId: 'client-dedup-1', expectedRevision: 3, input: { content } },
  CancelRun: {}, DecideApproval: { expectedRevision: 1, proposal, decision: 'accept' },
  CreateConnection: { serverId: 'server-1' }, DisconnectConnection: { expectedRevision: 1 },
};

export const responseFixtures = {
  ConversationSnapshot: { schemaVersion: 1, conversationId: 'conversation-1', revision: 1,
    createdAt: now, updatedAt: now, messages: [{ id: 'message-1', role: 'user', content }] },
  RunAccepted: { schemaVersion: 1, runId: 'run-1', conversationId: 'conversation-1', status: 'queued',
    revision: 1, snapshotUrl: '/api/v1/runs/run-1' },
  RunSnapshot: run, ApprovalView: approval, ConnectionView: connection,
  ConnectionPage: { schemaVersion: 1, items: [connection] },
  Capabilities: { schemaVersion: 1, apiVersion: 'v1', features: {
    tools: true, resources: true, prompts: true, durableRuns: false, eventReplay: false,
  }, limits: { requestBytes: 1_048_576, eventBytes: 262_144,
    idempotencyRetentionSeconds: 86_400, eventRetentionSeconds: 604_800 } },
};

export const eventPayloads = {
  'run.queued': { status: 'queued', revision: 1 },
  'run.started': { status: 'running', revision: 2 }, 'step.started': { index: 1 },
  'tool.started': { tool, attempt: 1 }, 'tool.completed': { outcome: 'success', resultMessageId: 'tool-result' },
  'tool.failed': { outcome: 'unknown', resultMessageId: 'tool-result', failure: reason },
  'run.input_required': { question: 'Which item?', revision: 3 }, 'approval.required': { approval },
  'message.completed': { message: finalMessage },
  'run.completed': { status: 'completed', revision: 4, finalMessageId: 'message-final' },
  'run.partial': { status: 'partial', revision: 4, reason, finalMessageId: 'message-final' },
  'run.failed': { status: 'failed', revision: 4, reason }, 'run.cancelled': { status: 'cancelled', revision: 4 },
};

export function eventFixture(type: keyof typeof eventPayloads) {
  return { schemaVersion: 1, eventId: 'event-1', sequence: 1, conversationId: 'conversation-1', runId: 'run-1',
    stepId: 'step-1', toolCallId: 'call-1', modelCallId: 'model-1', occurredAt: now, type, payload: eventPayloads[type] };
}
