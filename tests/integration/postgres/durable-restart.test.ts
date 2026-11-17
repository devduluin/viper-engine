import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabase } from './database.js';
import { driver, setupRun } from './durable-fixtures.js';
import { finalText } from '../../unit/runtime/harness.js';
import { owner } from './fixtures.js';
import { crashWorker } from '../../support/durable/process.js';
import type { IsolatedDatabase } from './database.js';

async function effects(db: IsolatedDatabase): Promise<number> {
  const result = await db.pool.query('SELECT count(*)::int AS n FROM public.fixture_effects');
  return Number(Reflect.get(Object(result.rows[0]), 'n'));
}

async function ready(db: IsolatedDatabase, suffix: string) {
  await db.pool.query('CREATE TABLE public.fixture_effects (call_id text NOT NULL)');
  return setupRun(db.pool, suffix);
}

test('OS-killed worker after a committed remote effect recovers unknown without any re-dispatch', async () => {
  const db = await createDatabase();
  try {
    const run = await ready(db, 'restart-inflight');
    await crashWorker(db.name, 'inflight', 'effect');
    assert.equal(await effects(db), 1);
    await db.pool.query('SELECT pg_sleep(1.1)');
    const next = await driver(db.pool, []);
    const result = await next.driver.runOnce('heir-inflight');
    assert.ok(result.kind === 'settled' && result.status === 'partial' && result.reason === 'unknown_outcome');
    assert.equal(next.mcp.calls.length, 0);
    assert.equal(await effects(db), 1);
    const cp = await next.deps.checkpoints.load(owner, run.runId); assert.ok(cp.ok);
    assert.deepEqual(cp.value.toolCalls.map(row => [row.status, row.attempts]), [['unknown', 1]]);
    assert.equal(cp.value.history.filter(message => message.role === 'tool' && message.outcome === 'unknown').length, 1);
  } finally { await db.drop(); }
});

test('OS-killed worker after outcome commit resumes from stored output and never replays success', async () => {
  const db = await createDatabase();
  try {
    const run = await ready(db, 'restart-reported');
    await crashWorker(db.name, 'reported', 'reported');
    await db.pool.query('SELECT pg_sleep(1.1)');
    const next = await driver(db.pool, [finalText('Used stored evidence')]);
    const result = await next.driver.runOnce('heir-reported');
    assert.ok(result.kind === 'settled' && result.status === 'completed');
    assert.equal(next.mcp.calls.length, 0);
    assert.equal(await effects(db), 1);
    const cp = await next.deps.checkpoints.load(owner, run.runId); assert.ok(cp.ok);
    assert.equal(cp.value.execution?.state['modelCalls'], 2);
    assert.equal(cp.value.history.filter(message => message.role === 'tool').length, 1);
  } finally { await db.drop(); }
});

test('OS-killed worker after final-message commit finishes without another model or tool call', async () => {
  const db = await createDatabase();
  try {
    const run = await ready(db, 'restart-final');
    await crashWorker(db.name, 'final', 'final');
    await db.pool.query('SELECT pg_sleep(1.1)');
    const next = await driver(db.pool, []);
    const result = await next.driver.runOnce('heir-final');
    assert.ok(result.kind === 'settled' && result.status === 'completed');
    assert.equal(next.model.requests.length, 0);
    assert.equal(next.mcp.calls.length, 0);
    const cp = await next.deps.checkpoints.load(owner, run.runId); assert.ok(cp.ok);
    assert.equal(cp.value.execution?.state['modelCalls'], 1);
  } finally { await db.drop(); }
});

test('model attempt reserved before a killed request is charged after restart and cannot reset its ceiling', async () => {
  const db = await createDatabase();
  try {
    const run = await ready(db, 'restart-model');
    await crashWorker(db.name, 'model', 'model');
    await db.pool.query('SELECT pg_sleep(1.1)');
    const next = await driver(db.pool, [finalText('Must not be requested')]);
    const result = await next.driver.runOnce('heir-model');
    assert.ok(result.kind === 'settled' && result.status === 'failed' && result.reason === 'model_call_limit');
    assert.equal(next.model.requests.length, 0);
    const audit = await db.pool.query('SELECT outcome, failure_code FROM viper_engine.model_calls WHERE run_id = $1', [run.runId]);
    assert.deepEqual(audit.rows[0], { outcome: 'failed', failure_code: 'unknown' });
  } finally { await db.drop(); }
});
