import { headlessFixture } from '../tests/support/client/headless-fixture.js';
import { done, toolTurn } from '../tests/integration/postgres/engine-fixtures.js';
import { runHeadlessTask } from './headless.js';

// Opt-in local demo: requires explicit VIPER_TEST_DB_*; never uses real provider keys.
if (!process.env['VIPER_TEST_DB_HOST']) {
  console.log('Skipping headless fixture demo: VIPER_TEST_DB_HOST is not set. Configure it in .env to run this demo.');
  process.exit(0);
}
const fixture = await headlessFixture([toolTurn('lookup_item', { id: 'a' }, 'read'), toolTurn('record_write', { count: 5 }, 'write'), done]);
try {
  const result = await runHeadlessTask(fixture.client, {
    input: { input: { content: [{ type: 'text', text: 'Read item a and propose recording count 5' }] } }, idempotencyKey: 'fixture-only',
    onUpdate: async update => {
      if (update.kind === 'snapshot') { console.log(`snapshot: ${update.snapshot.status}`); if (update.snapshot.status === 'queued') fixture.host.start(); }
      else console.log(`event ${update.event.sequence}: ${update.event.type}`);
    }, decide: async approval => {
      // This decision is valid only for the known local fixture, never a production auto-approval policy.
      if (approval.proposal.tool.name !== 'record_write' || approval.arguments['count'] !== 5) return 'reject';
      console.log('fixture decision: accept exact record_write(count=5)'); return 'accept';
    },
  });
  console.log(JSON.stringify({ status: result.status, usage: result.usage, writes: fixture.effects.writes() }));
  if (result.status !== 'completed' || fixture.effects.writes() !== 1) process.exitCode = 1;
} finally { await fixture.close(); }
