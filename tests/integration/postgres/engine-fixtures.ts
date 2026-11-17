import { parseId } from '../../../src/contracts/identity/ids.js';
import { parseMessage } from '../../../src/contracts/messages/parse-message.js';
import type { SqlPool } from '../../../src/adapters/persistence/postgres/sql-client.js';
import { PostgresCheckpointReader } from '../../../src/adapters/persistence/postgres/checkpoint-reader.js';
import { PostgresMessageStore } from '../../../src/adapters/persistence/postgres/message-store.js';
import { createViperEngine } from '../../../src/bootstrap/engine.js';
import type { ViperEngineOptions } from '../../../src/bootstrap/engine-types.js';
import type { EngineModel } from '../../../src/bootstrap/configured-model.js';
import { owner, seedRun } from './fixtures.js';
import { FakeAnthropic } from '../../support/anthropic/fake-api.js';
import type { FakeReply } from '../../support/anthropic/fake-api.js';

export const toolTurn = (name: string, input: object = {}, id = 'call-1'): FakeReply =>
  ({ blocks: [{ type: 'tool_use', id, name: `inv__${name}`, input }] });
export const done: FakeReply = { blocks: [{ type: 'text', text: 'Done using the evidence' }] };

export async function seedEngine(pool: SqlPool, endpoint: string, suffix: string) {
  const run = await seedRun(pool, owner, suffix);
  const connectionId = await seedEngineConnection(pool, endpoint, suffix);
  const appended = await new PostgresMessageStore(pool).append(owner, run.conversationId, { expectedRevision: 1, at: Date.now(),
    messages: [parseMessage({ id: `user-${suffix}`, role: 'user', content: [{ type: 'text', text: 'Perform the task' }] })] });
  if (!appended.ok) throw new Error('Cannot seed engine history');
  return { ...run, connectionId };
}

export async function seedEngineConnection(pool: SqlPool, endpoint: string, suffix: string) {
  const connectionId = parseId('mcp_connection', `connection-${suffix}`);
  await pool.query(`INSERT INTO viper_engine.mcp_servers (id, app_id, tenant_key, transport, endpoint_ref)
    VALUES ($1, $2, '', 'streamable_http', $3)`, [`server-${suffix}`, owner.appId, endpoint]);
  await pool.query(`INSERT INTO viper_engine.mcp_connections (id, actor_id, app_id, tenant_key, server_id, auth_state)
    VALUES ($1, $2, $3, '', $4, 'ready')`, [connectionId, owner.actorId, owner.appId, `server-${suffix}`]);
  return connectionId;
}

export function engine(pool: SqlPool, connectionId: ReturnType<typeof parseId<'mcp_connection'>>, model: EngineModel,
  overrides: Partial<ViperEngineOptions> = {}) {
  return createViperEngine(pool, {
    model, credentials: { resolve: async () => ({ ok: true, credential: { kind: 'none' } }),
      refresh: async () => ({ ok: false, code: 'authentication_required' }) },
    resolveEndpoint: server => ({ kind: 'streamable_http', url: server.endpointRef }),
    connections: async () => [{ id: connectionId, namespace: 'inv' }],
    policy: { decide: tool => tool.definition.ref.name === 'record_write' ? 'requires_approval' : 'execute' },
    requestTimeoutMs: 5000, discoveryTimeoutMs: 15000, leaseMs: 3000, heartbeatMs: 300,
    limits: { maxDurationMs: 30000 }, ...overrides,
  });
}

export function anthropic(replies: readonly FakeReply[]) {
  const api = new FakeAnthropic(replies);
  return { api, model: { provider: 'anthropic', model: 'claude-opus-5-5', gateway: api.gateway() } };
}

export async function checkpoint(pool: SqlPool, runId: ReturnType<typeof parseId<'run'>>) {
  const result = await new PostgresCheckpointReader(pool).load(owner, runId);
  if (!result.ok) throw new Error('Missing checkpoint');
  return result.value;
}
