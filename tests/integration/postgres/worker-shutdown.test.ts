import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabase } from './database.js';
import { driver, setupRun } from './durable-fixtures.js';
import { until } from './worker-fixtures.js';
import { PostgresRunLeaseStore } from '../../../src/adapters/persistence/postgres/lease-store.js';
import { createWorkerHost } from '../../../src/application/worker/host.js';
import { workerFailureCode } from '../../../src/bootstrap/worker/failures.js';
import { delay } from '../../../src/shared/async/delay.js';

test('timed-out shutdown stops renewing leases while an uncooperative failure callback is draining', async () => {
  const db = await createDatabase(); let renewals = 0; let entered = false;
  let release: (() => void) | undefined; const blocked = new Promise<void>(resolve => { release = resolve; });
  let host: ReturnType<typeof createWorkerHost> | undefined;
  try {
    await setupRun(db.pool, 'worker-stop-renewals'); const leases = new PostgresRunLeaseStore(db.pool);
    const h = await driver(db.pool, [], { leaseMs: 1000, heartbeatMs: 100,
      configure: async () => { throw new Error('Setup failed'); },
      onDeliveryFailure: async () => { entered = true; await blocked; },
      leases: { claimNext: (...args) => leases.claimNext(...args), release: (...args) => leases.release(...args),
        renew: (...args) => { renewals += 1; return leases.renew(...args); } },
    });
    host = createWorkerHost({ engine: { runOnce: (id, signal) => h.driver.runOnce(id, signal), close: async () => undefined },
      clock: { now: () => Date.now() }, maintain: async () => 0, classify: workerFailureCode },
    { workerId: 'stopping', concurrency: 1, shutdownTimeoutMs: 50 });
    host.start(); await until(() => entered);
    await assert.rejects(host.stop(), /worker shutdown/); const stoppedAt = renewals;
    await delay(250); assert.equal(renewals, stoppedAt);
    assert.equal(host.status().phase, 'stopping');
    release?.(); await host.done; assert.equal(host.status().phase, 'stopped');
  } finally { release?.(); await host?.done; await db.drop(); }
});
