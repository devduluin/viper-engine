import { EngineClientFailure } from '../../../src/contracts/client/failure.js';
import type { DurableEventView, RunSnapshotView } from '../../../src/contracts/client/views.js';
import { createEngineClient } from '../../../src/bootstrap/client.js';

export const snapshot = (overrides: Partial<RunSnapshotView> = {}): RunSnapshotView => ({ schemaVersion: 1, runId: 'run-1',
  conversationId: 'conversation-1', revision: 1, status: 'running', createdAt: 1, updatedAt: 1,
  eventCursor: 'cursor_0', lastEventSequence: 0, ...overrides });
export function event(sequence = 1, type = 'run.started'): DurableEventView {
  return { schemaVersion: 1, eventId: `event-${sequence}`, runId: 'run-1', conversationId: 'conversation-1',
    occurredAt: 1, sequence, type, payload: type === 'run.completed' ? { status: 'completed', revision: 2, finalMessageId: 'message-1' }
      : { status: 'running', revision: 1 } };
}
export const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
export const frame = (sequence = 1, type = 'run.started') => `id: cursor_${sequence}\nevent: ${type}\ndata: ${JSON.stringify(event(sequence, type))}\n\n`;
export const sse = (body: string) => new Response(body, { headers: { 'content-type': 'text/event-stream' } });
export const client = (fetch: typeof globalThis.fetch, options = {}) => createEngineClient({ baseUrl: 'http://127.0.0.1:9999',
  getToken: async () => 'private-token', fetch, ...options });
export function failure(code: string): (error: unknown) => boolean {
  return error => error instanceof EngineClientFailure && error.code === code && !error.message.includes('private');
}
