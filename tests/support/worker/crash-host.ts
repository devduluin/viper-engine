import { createDatabasePool } from '../../../src/bootstrap/database.js';
import { createWorkerHost } from '../../../src/application/worker/host.js';
import { testServerConfig } from '../../integration/postgres/database.js';
import { driver } from '../../integration/postgres/durable-fixtures.js';
import { callsOf, StubMcp } from '../../unit/runtime/harness.js';
import { workerFailureCode } from '../../../src/bootstrap/worker/failures.js';

const name = process.env['VIPER_RESTART_DB'];
if (name === undefined || !/^viper_it_[a-z0-9_]+$/.test(name)) throw new Error('Worker host requires an isolated test database');
const pool = createDatabasePool({ ...testServerConfig(), database: name });
const mcp = new StubMcp(async request => {
  await pool.query('INSERT INTO public.fixture_effects(call_id) VALUES ($1)', [request.toolCallId]);
  process.send?.({ marker: 'host-effect' });
  return new Promise(() => undefined);
});
const harness = await driver(pool, [callsOf(['host-crash-call', 'lookup'])], { mcp, leaseMs: 1000, heartbeatMs: 100 });
const host = createWorkerHost({ engine: { runOnce: (id, signal) => harness.driver.runOnce(id, signal), close: async () => undefined },
  clock: { now: () => Date.now() }, maintain: async () => 0, classify: workerFailureCode },
{ workerId: 'crash-host', concurrency: 1, pollMs: 20 });
host.start();
try { await host.done; } finally { await pool.end(); }
