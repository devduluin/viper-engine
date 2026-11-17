import assert from 'node:assert/strict';
import { owner, stores } from './fixtures.js';
import { parseId } from '../../../src/contracts/identity/ids.js';
import { PostgresMessageStore } from '../../../src/adapters/persistence/postgres/message-store.js';
import { PostgresCheckpointReader } from '../../../src/adapters/persistence/postgres/checkpoint-reader.js';
import type { SqlPool } from '../../../src/adapters/persistence/postgres/sql-client.js';
import type { EngineClient } from '../../../src/bootstrap/client.js';
import { oldHistory, policy } from '../../support/context/history.js';
import { decodeState } from '../../../src/application/durable/state.js';

export const enginePolicy = { ...policy, maxInputBytes: 12000, windowTokens: 16000 };
export async function historicalRun(pool: SqlPool, client: EngineClient, text = 'Perform task') {
  const conversation = await client.createConversation({ title: 'Context test' });
  const before = oldHistory();
  const prior = parseId('run', `history-${conversation.conversationId}`); const s = stores(pool);
  assert.ok((await s.runs.create(owner, { id: prior, conversationId: parseId('conversation', conversation.conversationId), at: Date.now(), events: [] })).ok);
  const result = await new PostgresMessageStore(pool).append(owner, parseId('conversation', conversation.conversationId),
    { expectedRevision: conversation.revision, at: Date.now(), messages: before, runId: prior });
  assert.ok(result.ok);
  assert.ok((await s.runs.transition(owner, prior, { to: 'running', expectedRevision: 1, at: Date.now(), events: [] })).ok);
  assert.ok((await s.runs.transition(owner, prior, { to: 'completed', expectedRevision: 2, at: Date.now(), events: [] })).ok);
  const run = await client.startRun(conversation.conversationId, { input: { content: [{ type: 'text', text }] } }, 'context-once');
  return { ...run, before };
}
export async function saved(pool: SqlPool, runId: string) {
  const loaded = await new PostgresCheckpointReader(pool).load(owner, parseId('run', runId)); assert.ok(loaded.ok && loaded.value.execution !== undefined);
  return { checkpoint: loaded.value, state: decodeState(loaded.value.execution.state) };
}
export const configure = (maxInputBytes = policy.maxInputBytes) => async () => ({ model: 'context-script', maxModelCalls: 8, maxOutputTokens: 100,
  tools: [], context: { ...policy, maxInputBytes } });
