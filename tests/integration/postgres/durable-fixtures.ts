import { randomUUID } from 'node:crypto';
import { parseId } from '../../../src/contracts/identity/ids.js';
import { parseMessage } from '../../../src/contracts/messages/parse-message.js';
import { DurableRunDriver } from '../../../src/application/durable/driver.js';
import type { DurableDriverDependencies } from '../../../src/application/durable/types.js';
import { PostgresRunLeaseStore } from '../../../src/adapters/persistence/postgres/lease-store.js';
import { PostgresRunJournal } from '../../../src/adapters/persistence/postgres/run-journal.js';
import { PostgresCheckpointReader } from '../../../src/adapters/persistence/postgres/checkpoint-reader.js';
import { PostgresMessageStore } from '../../../src/adapters/persistence/postgres/message-store.js';
import { ScriptedModel } from '../../support/agent/scripted-model.js';
import { StubMcp, acceptAll, executeAll, success } from '../../unit/runtime/harness.js';
import type { ModelResult } from '../../../src/contracts/models/gateway.js';
import type { SqlPool } from '../../../src/adapters/persistence/postgres/sql-client.js';
import { owner, seedConnection, seedRun, stores } from './fixtures.js';

export const clock = { now: () => Date.now() };
export const ids = { next: <K extends string>(kind: K) => parseId(kind, `${kind}-${randomUUID()}`) };

export async function setupRun(pool: SqlPool, suffix: string) {
  const run = await seedRun(pool, owner, suffix);
  const tool = await seedConnection(pool, owner, 'durable-connection');
  const messages = new PostgresMessageStore(pool);
  const appended = await messages.append(owner, run.conversationId, { expectedRevision: 1, at: clock.now(),
    messages: [parseMessage({ id: `user-${suffix}`, role: 'user', content: [{ type: 'text', text: 'Do the task' }] })] });
  if (!appended.ok) throw new Error('Cannot seed history');
  return { ...run, tool };
}

export async function driver(pool: SqlPool, frames: readonly ModelResult[], overrides: Partial<DurableDriverDependencies> = {}, maxModelCalls = 8) {
  const tool = await seedConnection(pool, owner, 'durable-connection');
  const model = new ScriptedModel(frames.map(result => ({ result })), clock);
  const mcp = new StubMcp(() => success({ done: true }));
  const deps: DurableDriverDependencies = {
    model, mcp, clock, ids, validator: acceptAll, policy: executeAll, provider: 'scripted-test',
    leases: new PostgresRunLeaseStore(pool), runs: stores(pool).runs,
    checkpoints: new PostgresCheckpointReader(pool), journal: new PostgresRunJournal(pool), leaseMs: 3000, heartbeatMs: 300,
    configure: async scope => ({ model: 'scripted-test', maxModelCalls, maxOutputTokens: 100,
      limits: { maxDurationMs: 15000 }, tools: [{ alias: 'lookup', context: { scope, connection: { id: tool.connectionId, serverId: tool.serverId } },
        definition: { ref: tool, inputSchema: { type: 'object' } } }] }), ...overrides,
  };
  return { deps, model, mcp, driver: new DurableRunDriver(deps) };
}
