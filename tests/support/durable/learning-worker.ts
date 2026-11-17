import { createDatabasePool } from '../../../src/bootstrap/database.js';
import { testServerConfig } from '../../integration/postgres/database.js';
import { createEngineLearning } from '../../../src/bootstrap/learning.js';
import type { SqlPool } from '../../../src/adapters/persistence/postgres/sql-client.js';
import { parseId } from '../../../src/contracts/identity/ids.js';
import { owner } from '../../integration/postgres/fixtures.js';

const database = process.env['VIPER_RESTART_DB']; const mode = process.env['VIPER_RESTART_MODE'];
if (database === undefined || !/^viper_it_[a-z0-9_]+$/.test(database)) throw new Error('Learning fixture requires isolated DB');
const pool = createDatabasePool({ ...testServerConfig(), database });
const pause = async (marker: string) => { process.send?.({ marker }); await new Promise(() => undefined); };
const wrapped: SqlPool = {
  query: (sql, values) => pool.query(sql, values),
  async connect() {
    const connection = await pool.connect(); return { release: () => connection.release(),
      async query(sql: string, values?: unknown[]) {
        const result = await connection.query(sql, values);
        if (mode === 'before' && sql.startsWith('UPDATE viper_engine.memory_proposals')) await pause('promotion-before-commit');
        return result;
      } };
  },
};
const learning = createEngineLearning(wrapped, { ids: { next: kind => parseId(kind, `${kind}-crash`) } });
try {
  const result = await pool.query("SELECT id FROM viper_engine.memory_proposals WHERE status = 'pending'");
  const proposal = await learning.getProposal(owner, String(result.rows[0]?.id));
  await learning.review(owner, proposal.proposalId, { expectedRevision: proposal.revision, digest: proposal.digest, decision: 'accept',
    confirmation: { conversationId: proposal.conversationId, messageId: 'confirmation' } });
  await pause('promotion-after-commit');
} finally { await pool.end(); }
