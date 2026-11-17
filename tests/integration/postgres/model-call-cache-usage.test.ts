import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PostgresExecutionLedger } from '../../../src/adapters/persistence/postgres/execution-ledger.js';
import { parseId } from '../../../src/contracts/identity/ids.js';
import type { ModelUsage } from '../../../src/contracts/models/usage.js';
import { createDatabase } from './database.js';
import type { IsolatedDatabase } from './database.js';
import { AT, owner, seedRun } from './fixtures.js';

let db: IsolatedDatabase;
before(async () => { db = await createDatabase(); });
after(async () => { await db.drop(); });

async function finished(suffix: string, usage: ModelUsage) {
  const { runId } = await seedRun(db.pool, owner, suffix);
  const ledger = new PostgresExecutionLedger(db.pool);
  const stepId = parseId('step', `${suffix}-step`); const modelCallId = parseId('model_call', `${suffix}-mc`);
  assert.ok((await ledger.startStep(owner, { runId, stepId, stepIndex: 1, at: AT })).ok);
  assert.ok((await ledger.startModelCall(owner, { runId, stepId, modelCallId, attempt: 1, provider: 'anthropic', model: 'claude-opus-5-5', at: AT })).ok);
  assert.ok((await ledger.finishModelCall(owner, { runId, modelCallId, outcome: 'succeeded', usage, at: AT + 1 })).ok);
  const row = await db.pool.query('SELECT input_tokens, cache_read_tokens, cache_write_tokens FROM viper_engine.model_calls WHERE id = $1', [modelCallId]);
  return { modelCallId, row: row.rows[0] };
}

test('model calls keep provider cache reads/writes as parts of input_tokens; unreported stays NULL', async () => {
  const cached = await finished('cache-on', { source: 'provider', inputTokens: 15000, outputTokens: 100, totalTokens: 15100, cacheReadTokens: 14000, cacheWriteTokens: 600 });
  assert.deepEqual(cached.row, { input_tokens: '15000', cache_read_tokens: '14000', cache_write_tokens: '600' });
  const plain = await finished('cache-none', { source: 'provider', inputTokens: 900, outputTokens: 10, totalTokens: 910 });
  assert.deepEqual(plain.row, { input_tokens: '900', cache_read_tokens: null, cache_write_tokens: null });
});

test('the database refuses cache counts above input or on unavailable usage, even from raw SQL', async () => {
  const { modelCallId } = await finished('cache-raw', { source: 'provider', inputTokens: 100, outputTokens: 1, totalTokens: 101, cacheReadTokens: 40 });
  await assert.rejects(db.pool.query('UPDATE viper_engine.model_calls SET cache_read_tokens = 90, cache_write_tokens = 20 WHERE id = $1', [modelCallId]),
    /model_calls_cache_within_input/);
  await assert.rejects(db.pool.query("UPDATE viper_engine.model_calls SET usage_source = 'unavailable', input_tokens = NULL, output_tokens = NULL, total_tokens = NULL WHERE id = $1", [modelCallId]),
    /model_calls_cache_unavailable/);
});
