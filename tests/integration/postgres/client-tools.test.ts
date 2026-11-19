import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabase } from './database.js';
import { driver, setupRun } from './durable-fixtures.js';
import { http, request, newConversation, INPUT } from './http-fixtures.js';
import { callsOf, finalText, StubMcp } from '../../unit/runtime/harness.js';
import type { ClientToolPort } from '../../../src/agent/runtime/types.js';
import { createClientToolPort } from '../../../src/bootstrap/client-tools.js';
import { ClientToolBroker } from '../../../src/application/streaming/client-tools.js';
import { DeltaBus } from '../../../src/application/streaming/delta-bus.js';

const READ_PAGE = { name: 'read_page', description: 'Read the open page', inputSchema: { type: 'object' } };

test('durable run: a client tool step is journaled as assistant + result without MCP proposals, then the run completes', async () => {
  const db = await createDatabase();
  try {
    const run = await setupRun(db.pool, 'client-tool');
    await db.pool.query(`UPDATE viper_engine.runs SET client_tools = ARRAY['read_page'] WHERE id = $1`, [run.runId]);
    const bus = new DeltaBus(); const broker = new ClientToolBroker(bus, Date.now, 50);
    bus.subscribe(run.runId, frame => {
      if (frame.type === 'client_tool.request') broker.reply(frame.runId, frame.toolCallId, { outcome: 'success', data: { title: 'Daftar Karyawan' } });
    });
    const clientTools: ClientToolPort = createClientToolPort(db.pool, { definitions: [READ_PAGE], timeoutMs: 5000 }, broker);
    const h = await driver(db.pool, [callsOf(['p1', 'client__read_page']), finalText('Halaman berisi daftar karyawan.')], { clientTools, mcp: new StubMcp(() => assert.fail('no MCP')) });
    const result = await h.driver.runOnce('client-tool');
    assert.ok(result.kind === 'settled' && result.status === 'completed', JSON.stringify(result));
    assert.ok(h.model.requests[0]?.tools.some(tool => tool.name === 'client__read_page'));
    const stored = await db.pool.query(`SELECT role, tool_call_id, outcome FROM viper_engine.messages WHERE run_id = $1 ORDER BY position`, [run.runId]);
    assert.deepEqual(stored.rows.map(row => [row.role, row.tool_call_id, row.outcome]),
      [['assistant', null, null], ['tool', 'p1', 'success'], ['assistant', null, null]]);
    const proposals = await db.pool.query('SELECT count(*)::int AS n FROM viper_engine.tool_calls WHERE run_id = $1', [run.runId]);
    assert.equal(proposals.rows[0].n, 0, 'client tools never create MCP tool call records');
  } finally { await db.drop(); }
});

test('runs without client tools are not offered any; the port only offers configured names the run asked for', async () => {
  const db = await createDatabase();
  try {
    const run = await setupRun(db.pool, 'no-client-tool');
    const port = createClientToolPort(db.pool, { definitions: [READ_PAGE] });
    assert.deepEqual(await port.definitions(run.runId as never), []);
    await db.pool.query(`UPDATE viper_engine.runs SET client_tools = ARRAY['read_page', 'unknown_tool'] WHERE id = $1`, [run.runId]);
    assert.deepEqual((await port.definitions(run.runId as never)).map(tool => tool.name), ['client__read_page']);
  } finally { await db.drop(); }
});

test('start run stores clientTools; client-results is owner-only, bounded, and reports when nothing is waiting', async () => {
  const db = await createDatabase(); const app = http(db.pool);
  try {
    const conversation = await newConversation(app);
    const accepted = await request(app, 'POST', `/api/v1/conversations/${conversation}/runs`,
      { ...INPUT, options: { clientTools: ['read_page'] } }, { key: 'key-ct', status: 202 });
    const runId = String(accepted['runId']);
    const stored = await db.pool.query('SELECT client_tools FROM viper_engine.runs WHERE id = $1', [runId]);
    assert.deepEqual(stored.rows[0].client_tools, ['read_page']);
    await request(app, 'POST', `/api/v1/conversations/${await newConversation(app)}/runs`, { ...INPUT, options: { clientTools: ['Bad Name'] } }, { key: 'key-bad', status: 400 });
    const url = `/api/v1/runs/${runId}/client-results`;
    const answer = await request(app, 'POST', url, { toolCallId: 'p1', outcome: 'success', data: { title: 'x' } }, { status: 200, schema: 'ClientToolAccepted' });
    assert.equal(answer['accepted'], false, 'nothing waiting (run not running here)');
    await request(app, 'POST', url, { toolCallId: 'p1', outcome: 'error', message: 'Tidak bisa' }, { token: 'other', status: 404 });
    await request(app, 'POST', url, { toolCallId: 'p1', outcome: 'success', data: { text: 'x'.repeat(60_000) } }, { status: 413 });
  } finally { await app.close(); await db.drop(); }
});
