import { createDatabasePool } from '../../../src/bootstrap/database.js';
import { testServerConfig } from '../../integration/postgres/database.js';
import { driver } from '../../integration/postgres/durable-fixtures.js';
import { finalText } from '../../unit/runtime/harness.js';

const database = process.env['VIPER_RESTART_DB'];
if (database === undefined || !/^viper_it_[a-z0-9_]+$/.test(database)) throw new Error('Rejection fixture requires isolated DB');
const pool = createDatabasePool({ ...testServerConfig(), database });
const h = await driver(pool, [finalText('Should pause before generating')], { leaseMs: 1000, heartbeatMs: 100,
  policy: { decide: () => 'requires_approval' }, onEvent: async event => {
    if (event.type !== 'tool_call_reported' || event.report.failureCode !== 'rejected_by_user') return;
    process.send?.({ marker: 'decline-committed' }); await new Promise(() => undefined);
  } });
try { await h.driver.runOnce('decline-crash'); } finally { await pool.end(); }
