import { createDatabasePool } from '../../../src/bootstrap/database.js';
import { testServerConfig } from '../../integration/postgres/database.js';
import { driver } from '../../integration/postgres/durable-fixtures.js';
import { callsOf, finalText, StubMcp, success } from '../../unit/runtime/harness.js';
import type { RuntimeEvent } from '../../../src/agent/runtime/types.js';

const name = process.env['VIPER_RESTART_DB'];
if (name === undefined || !/^viper_it_[a-z0-9_]+$/.test(name)) throw new Error('Restart worker requires an isolated test database');
const mode = process.env['VIPER_RESTART_MODE'];
const pool = createDatabasePool({ ...testServerConfig(), database: name });

function pause(marker: string): Promise<never> {
  process.send?.({ marker });
  return new Promise(() => {});
}

async function observer(event: RuntimeEvent): Promise<void> {
  if (mode === 'reported' && event.type === 'tool_call_reported') await pause('reported');
  if (mode === 'final' && event.type === 'message_appended' && event.decision === 'final') await pause('final');
  if (mode === 'model' && event.type === 'model_call_started') await pause('model');
}

const mcp = new StubMcp(async request => {
  await pool.query('INSERT INTO public.fixture_effects (call_id) VALUES ($1)', [request.toolCallId]);
  if (mode === 'inflight') return pause('effect');
  return success({ applied: true });
});
const h = await driver(pool, mode === 'final' ? [finalText('Stored final')] : [callsOf(['crash-call', 'lookup'])],
  { mcp, onEvent: observer, leaseMs: 1000, heartbeatMs: 100 }, mode === 'model' ? 1 : 8);
try {
  const result = await h.driver.runOnce('crash-worker');
  process.send?.({ unexpected: result });
} finally { await pool.end(); }
