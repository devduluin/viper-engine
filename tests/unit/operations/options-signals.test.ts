import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { standaloneOptions } from '../../../examples/standalone-options.js';
import { runEngineHostUntilSignal } from '../../../src/bootstrap/operations/signals.js';
import { scopeFromAuthenticatedIdentity } from '../../../src/contracts/identity/scope.js';
import { testScope } from '../../support/agent/setup.js';

const env = { VIPER_LOCAL_TOKEN: '1'.repeat(64), VIPER_CURSOR_SECRET: '2'.repeat(64), VIPER_ACTOR_ID: 'owner', VIPER_APP_ID: 'app' };
test('starter auth rejects malformed/unicode credentials and selects connections only for its owner', async () => {
  const { http, engine } = standaloneOptions({ ...env, VIPER_MCP_CONNECTION_IDS: 'connection-a' });
  const identity = await http.authenticate(env.VIPER_LOCAL_TOKEN); assert.ok(identity);
  assert.equal(await http.authenticate('é'.repeat(64)), undefined);
  assert.equal(await http.authenticate('0'.repeat(64)), undefined);
  assert.equal(await http.authorizeServer(scopeFromAuthenticatedIdentity(identity), 'unconfigured'), false);
  assert.deepEqual(await engine.connections(scopeFromAuthenticatedIdentity(identity)), [{ id: 'connection-a' }]);
  await assert.rejects(engine.connections(testScope('different-owner')), /owner mismatch/);
  assert.throws(() => standaloneOptions({ ...env, VIPER_CURSOR_SECRET: env.VIPER_LOCAL_TOKEN }), /must differ/);
  assert.throws(() => standaloneOptions({ ...env, VIPER_MCP_CONNECTION_IDS: 'same,same' }), /Invalid MCP/);
});

test('host signals remove listeners on shutdown and on runtime failure', async () => {
  const signals = new EventEmitter(); let finish!: () => void; let closes = 0;
  const done = new Promise<void>(resolve => { finish = resolve; });
  const host = { done, close: async () => { closes++; finish(); } };
  const running = runEngineHostUntilSignal(host, signals);
  signals.emit('SIGTERM'); await running;
  assert.equal(closes, 1); assert.equal(signals.listenerCount('SIGINT'), 0); assert.equal(signals.listenerCount('SIGTERM'), 0);
  await assert.rejects(runEngineHostUntilSignal({ done: Promise.reject(new Error('runtime failed')), close: async () => undefined }, signals), /runtime failed/);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});
