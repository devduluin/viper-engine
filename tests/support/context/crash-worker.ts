import { createDatabasePool } from '../../../src/bootstrap/database.js';
import { testServerConfig } from '../../integration/postgres/database.js';
import { driver } from '../../integration/postgres/durable-fixtures.js';
import { configure } from '../../integration/postgres/context-fixtures.js';
import { finalText } from '../../unit/runtime/harness.js';

const database = process.env['VIPER_RESTART_DB'];
if (database === undefined || !/^viper_it_[a-z0-9_]+$/.test(database)) throw new Error('Context crash fixture needs an isolated DB');
const pool = createDatabasePool({ ...testServerConfig(), database });
const h = await driver(pool, [finalText('Should not be generated before kill')], { configure: configure(), leaseMs: 1000, heartbeatMs: 100,
  onEvent: async event => {
    if (event.type !== 'model_call_started') return;
    if (event.contextCheckpoint === undefined) throw new Error('Missing committed context');
    process.send?.({ marker: 'context-committed' }); await new Promise(() => undefined);
  } });
try { await h.driver.runOnce('context-crash'); } finally { await pool.end(); }
