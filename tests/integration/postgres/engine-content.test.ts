import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabase } from './database.js';
import { seedEngine, engine, anthropic, toolTurn, done, checkpoint } from './engine-fixtures.js';
import { startHttpServer } from '../../support/mcp/harness.js';
import { engineFixture } from '../../support/mcp/engine-fixture.js';
import { FakeOpenAI } from '../../support/openai/fake-api.js';

test('Anthropic receives MCP text/image/resources and structured evidence without private meta', async () => {
  const db = await createDatabase(); const fixture = engineFixture(); const server = await startHttpServer({ fixture });
  const run = await seedEngine(db.pool, server.url, 'engine-rich');
  const { api, model } = anthropic([toolTurn('rich_result'), done]); const app = engine(db.pool, run.connectionId, model);
  try {
    const result = await app.runOnce('rich');
    assert.ok(result.kind === 'settled' && result.status === 'completed', JSON.stringify(result));
    const projected = JSON.stringify(api.bodies[1]?.['messages']);
    for (const evidence of ['Visible evidence', 'image', 'aGVsbG8=', 'Embedded evidence', 'fixture://reference', 'confirmed']) {
      assert.ok(projected.includes(evidence), evidence);
    }
    assert.ok(!projected.includes('PRIVATE_MCP_META'));
    assert.equal((await checkpoint(db.pool, run.runId)).toolCalls[0]?.status, 'succeeded');
  } finally { await app.close(); await server.stop(); await db.drop(); }
});

test('OpenAI projects tool-result images after complete tool batch with matching call IDs', async () => {
  const db = await createDatabase(); const fixture = engineFixture(); const server = await startHttpServer({ fixture });
  const run = await seedEngine(db.pool, server.url, 'engine-openai');
  const api = new FakeOpenAI([{ toolCalls: [
    { id: 'rich-call', name: 'inv__rich_result', argumentFragments: ['{}'] },
    { id: 'add-call', name: 'inv__add', argumentFragments: ['{"a":2,"b":3}'] },
  ] }, { text: ['Evidence received'] }]);
  const app = engine(db.pool, run.connectionId, { provider: 'openai', model: 'configured-chat-model', gateway: api.gateway() });
  try {
    const result = await app.runOnce('openai');
    assert.ok(result.kind === 'settled' && result.status === 'completed', JSON.stringify(result));
    const messages = api.bodies[1]?.['messages'] as Record<string, unknown>[];
    assert.deepEqual(messages.map(message => message['role']), ['user', 'assistant', 'tool', 'tool', 'user']);
    assert.deepEqual(messages.filter(message => message['role'] === 'tool').map(message => message['tool_call_id']), ['rich-call', 'add-call']);
    const last = JSON.stringify(messages.at(-1));
    assert.match(last, /image_url/); assert.match(last, /data:image\/png;base64,aGVsbG8=/);
    assert.match(last, /rich-call/);
    assert.ok(!JSON.stringify(messages).includes('PRIVATE_MCP_META'));
    assert.deepEqual(fixture.calls, ['rich_result', 'add']);
    assert.equal((await checkpoint(db.pool, run.runId)).toolCalls.length, 2);
  } finally { await app.close(); await server.stop(); await db.drop(); }
});

test('unsupported audio remains durable but terminates before another provider call or tool replay', async () => {
  const db = await createDatabase(); const fixture = engineFixture(); const server = await startHttpServer({ fixture });
  const run = await seedEngine(db.pool, server.url, 'engine-audio');
  const { api, model } = anthropic([toolTurn('audio_result'), done]); const app = engine(db.pool, run.connectionId, model);
  try {
    const result = await app.runOnce('audio');
    assert.ok(result.kind === 'settled' && result.status === 'failed' && result.reason === 'model_failure', JSON.stringify(result));
    assert.equal(api.bodies.length, 1);
    assert.deepEqual(fixture.calls, ['audio_result']);
    const cp = await checkpoint(db.pool, run.runId);
    assert.equal(cp.toolCalls[0]?.status, 'succeeded');
    assert.ok(cp.history.some(message => message.role === 'tool' && message.content.some(block => block.type === 'audio')));
    assert.deepEqual(await app.runOnce('no-replay'), { kind: 'idle' });
  } finally { await app.close(); await server.stop(); await db.drop(); }
});
