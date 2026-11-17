import assert from 'node:assert/strict';
import test from 'node:test';
import { isLoopbackHost, parseDatabaseConfig } from '../../../src/bootstrap/database-config.js';

const base = { VIPER_DB_HOST: '127.0.0.1', VIPER_DB_NAME: 'viper_engine_dev', VIPER_DB_USER: 'postgres' };

test('separate VIPER_DB_* variables build the pool config with safe defaults', () => {
  assert.deepEqual(parseDatabaseConfig(base), {
    host: '127.0.0.1', port: 5432, database: 'viper_engine_dev', user: 'postgres', ssl: false, maxConnections: 10,
  });
  const full = parseDatabaseConfig({ ...base, VIPER_DB_PORT: '6543', VIPER_DB_PASSWORD: 'p@ss:/w#rd', VIPER_DB_SSL: 'TRUE', VIPER_DB_POOL_MAX: '4' });
  assert.deepEqual([full.port, full.password, full.ssl, full.maxConnections], [6543, 'p@ss:/w#rd', true, 4]);
  assert.equal('password' in parseDatabaseConfig({ ...base, VIPER_DB_PASSWORD: '' }), false);
});

test('missing or invalid settings are rejected instead of guessed', () => {
  for (const key of ['VIPER_DB_HOST', 'VIPER_DB_NAME', 'VIPER_DB_USER'] as const) {
    assert.throws(() => parseDatabaseConfig({ ...base, [key]: ' ' }), new RegExp(`${key} is required`));
  }
  for (const [key, value] of [['VIPER_DB_PORT', '0'], ['VIPER_DB_PORT', '70000'], ['VIPER_DB_PORT', '54x'],
    ['VIPER_DB_SSL', 'yes'], ['VIPER_DB_POOL_MAX', '0'], ['VIPER_DB_NAME', 'drop table;'], ['VIPER_DB_HOST', 'a b']] as const) {
    assert.throws(() => parseDatabaseConfig({ ...base, [key]: value }), new RegExp(key));
  }
});

test('the prefix selects an independent variable set; loopback detection is exact', () => {
  const config = parseDatabaseConfig({ VIPER_TEST_DB_HOST: 'localhost', VIPER_TEST_DB_NAME: 'postgres', VIPER_TEST_DB_USER: 'u' }, 'VIPER_TEST_DB');
  assert.equal(config.database, 'postgres');
  assert.throws(() => parseDatabaseConfig(base, 'VIPER_TEST_DB'), /VIPER_TEST_DB_HOST is required/);
  assert.deepEqual(['127.0.0.1', 'localhost', '::1', '10.0.0.5', 'db.example.com'].map(isLoopbackHost), [true, true, true, false, false]);
});
