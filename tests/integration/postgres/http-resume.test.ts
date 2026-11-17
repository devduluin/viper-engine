import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabase } from './database.js';
import { http, request, newConversation, start, field, errorCode } from './http-fixtures.js';
import { driver } from './durable-fixtures.js';
import { callsOf, decided, finalText } from '../../unit/runtime/harness.js';
import { parseJsonObject } from '../../../src/contracts/messages/json.js';

test('HTTP clarification uses run revision and durable input dedup across wake, completion and new server', async () => {
  const db = await createDatabase(); const app = http(db.pool); let restarted: ReturnType<typeof http> | undefined;
  try {
    const started = await start(app, await newConversation(app)); const id = field(started, 'runId');
    const paused = await driver(db.pool, [decided({ kind: 'needs_input', question: 'Which item?' })]);
    await paused.driver.runOnce('http-input-pause');
    const snapshot = await request(app, 'GET', `/api/v1/runs/${id}`, undefined, { status: 200, schema: 'RunSnapshot' });
    assert.equal(snapshot['inputQuestion'], 'Which item?');
    const body = { inputId: 'input-once', expectedRevision: snapshot['revision'], input: { content: [{ type: 'text', text: 'item-a' }] } };
    const stale = await request(app, 'POST', `/api/v1/runs/${id}/inputs`, { ...body, expectedRevision: 1 }, { status: 409 });
    assert.equal(errorCode(stale), 'REVISION_CONFLICT');
    assert.equal(errorCode(await request(app, 'POST', `/api/v1/runs/${id}/inputs`, body, { token: 'other', status: 404 })), 'NOT_FOUND');
    const responses = await Promise.all([1, 2].map(() => request(app, 'POST', `/api/v1/runs/${id}/inputs`, body,
      { status: 202, schema: 'RunAccepted' })));
    assert.deepEqual(responses[0], responses[1]);
    const next = await driver(db.pool, [finalText('Got item-a')]);
    assert.equal((await next.driver.runOnce('http-input-complete')).kind, 'settled');
    await app.close(); restarted = http(db.pool);
    assert.deepEqual(await request(restarted, 'POST', `/api/v1/runs/${id}/inputs`, body, { status: 202 }), responses[0]);
    const changed = await request(restarted, 'POST', `/api/v1/runs/${id}/inputs`,
      { ...body, input: { content: [{ type: 'text', text: 'item-b' }] } }, { status: 409 });
    assert.equal(errorCode(changed), 'IDEMPOTENCY_CONFLICT');
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM viper_engine.input_receipts')).rows[0].n, 1);
    const final = await request(restarted, 'GET', `/api/v1/runs/${id}`, undefined, { status: 200, schema: 'RunSnapshot' });
    assert.equal(final['status'], 'completed'); assert.match(JSON.stringify(final['finalMessage']), /Got item-a/);
  } finally { await app.close(); await restarted?.close(); await db.drop(); }
});

test('HTTP approval compares immutable binding, wakes atomically and dispatches only through a new worker', async () => {
  const db = await createDatabase(); const app = http(db.pool);
  try {
    const started = await start(app, await newConversation(app)); const id = field(started, 'runId');
    const first = await driver(db.pool, [callsOf(['http-call', 'lookup', { count: 5 }])], { policy: { decide: () => 'requires_approval' } });
    await first.driver.runOnce('http-approval-pause');
    const snapshot = await request(app, 'GET', `/api/v1/runs/${id}`, undefined, { status: 200, schema: 'RunSnapshot' });
    const approval = parseJsonObject((snapshot['pendingApprovals'] as readonly unknown[])[0]);
    assert.deepEqual(approval['arguments'], { count: 5 });
    const url = `/api/v1/approvals/${field(approval, 'approvalId')}/decision`;
    const body = { expectedRevision: approval['revision'], proposal: approval['proposal'], decision: 'accept' };
    await request(app, 'POST', url, body, { token: 'other', status: 404 });
    const mismatch = await request(app, 'POST', url,
      { ...body, proposal: { ...parseJsonObject(approval['proposal']), argumentsDigest: 'f'.repeat(64) } }, { status: 409 });
    assert.equal(errorCode(mismatch), 'APPROVAL_MISMATCH');
    const accepted = await request(app, 'POST', url, body, { status: 200, schema: 'ApprovalView' });
    assert.equal(accepted['status'], 'accepted'); assert.equal(first.mcp.calls.length, 0);
    assert.equal((await request(app, 'GET', `/api/v1/runs/${id}`, undefined, { status: 200 }))['status'], 'running');
    const next = await driver(db.pool, [finalText('Approved')], { policy: { decide: () => 'requires_approval' } });
    const finished = await next.driver.runOnce('http-approval-execute');
    assert.ok(finished.kind === 'settled' && finished.status === 'completed');
    assert.deepEqual(next.mcp.calls.map(call => call.arguments), [{ count: 5 }]);
    await request(app, 'POST', url, body, { status: 409 });
    assert.equal(next.mcp.calls.length, 1);
  } finally { await app.close(); await db.drop(); }
});

test('HTTP rejection resumes with explicit rejection evidence and never invokes rejected tool', async () => {
  const db = await createDatabase(); const app = http(db.pool);
  try {
    const started = await start(app, await newConversation(app)); const id = field(started, 'runId');
    const first = await driver(db.pool, [callsOf(['rejected-http', 'lookup'])], { policy: { decide: () => 'requires_approval' } });
    await first.driver.runOnce('reject-pause');
    const snapshot = await request(app, 'GET', `/api/v1/runs/${id}`, undefined, { status: 200 });
    const approval = parseJsonObject((snapshot['pendingApprovals'] as readonly unknown[])[0]);
    await request(app, 'POST', `/api/v1/approvals/${field(approval, 'approvalId')}/decision`,
      { expectedRevision: approval['revision'], proposal: approval['proposal'], decision: 'reject' }, { status: 200 });
    const next = await driver(db.pool, [finalText('Rejected')], { policy: { decide: () => 'requires_approval' } });
    const result = await next.driver.runOnce('reject-finish');
    assert.ok(result.kind === 'settled' && result.status === 'completed', JSON.stringify(result)); assert.equal(next.mcp.calls.length, 0);
    const ledger = await db.pool.query('SELECT status FROM viper_engine.tool_calls WHERE run_id = $1', [id]);
    assert.equal(ledger.rows[0].status, 'rejected');
  } finally { await app.close(); await db.drop(); }
});

test('multiple approvals stay paused until the final decision and stale decision returns current revision', async () => {
  const db = await createDatabase(); const app = http(db.pool);
  try {
    const started = await start(app, await newConversation(app)); const id = field(started, 'runId');
    const first = await driver(db.pool, [callsOf(['http-one', 'lookup', { id: 'one' }], ['http-two', 'lookup', { id: 'two' }])],
      { policy: { decide: () => 'requires_approval' } });
    await first.driver.runOnce('http-multiple-pause');
    const snapshot = await request(app, 'GET', `/api/v1/runs/${id}`, undefined, { status: 200 });
    const proposals = (snapshot['pendingApprovals'] as readonly unknown[]).map(parseJsonObject); assert.equal(proposals.length, 2);
    for (const [index, proposal] of proposals.entries()) {
      const url = `/api/v1/approvals/${field(proposal, 'approvalId')}/decision`;
      const body = { expectedRevision: proposal['revision'], proposal: proposal['proposal'], decision: 'accept' };
      await request(app, 'POST', url, body, { status: 200 });
      const state = await request(app, 'GET', `/api/v1/runs/${id}`, undefined, { status: 200 });
      assert.equal(state['status'], index === 0 ? 'waiting_for_approval' : 'running');
      const stale = await request(app, 'POST', url, body, { status: 409 });
      assert.equal(errorCode(stale), 'REVISION_CONFLICT');
      assert.equal(parseJsonObject(parseJsonObject(stale['error'])['recovery'])['currentRevision'], 2);
    }
    assert.equal(first.mcp.calls.length, 0);
    const next = await driver(db.pool, [finalText('Both approved')], { policy: { decide: () => 'requires_approval' } });
    await next.driver.runOnce('http-multiple-execute'); assert.equal(next.mcp.calls.length, 2);
  } finally { await app.close(); await db.drop(); }
});
