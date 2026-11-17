import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFoundationConfig } from '../../src/bootstrap/config.js';

test('foundation config has local defaults and is immutable', () => {
  const config = parseFoundationConfig({});
  assert.deepEqual(config, {
    environment: 'development', host: '127.0.0.1', port: 3010, logLevel: 'info',
  });
  assert.equal(Object.isFrozen(config), true);
});

test('foundation config is injected and ignores unrelated environment secrets', () => {
  assert.deepEqual(parseFoundationConfig({
    VIPER_ENV: 'test', VIPER_HOST: '::1', VIPER_PORT: '4020', VIPER_LOG_LEVEL: 'warn',
    UNRELATED_SECRET: 'not-in-result',
  }), { environment: 'test', host: '::1', port: 4020, logLevel: 'warn' });
});

test('invalid ports fail without reflecting environment contents', () => {
  for (const port of ['0', '-1', '65536', '3.5', '3010garbage', '', 'Infinity']) {
    assert.throws(() => parseFoundationConfig({ VIPER_PORT: port }), /^Error: Invalid VIPER_PORT$/);
  }
});

test('invalid enums and empty hosts are rejected', () => {
  assert.throws(() => parseFoundationConfig({ VIPER_ENV: 'unknown' }), /VIPER_ENV/);
  assert.throws(() => parseFoundationConfig({ VIPER_LOG_LEVEL: 'unknown' }), /VIPER_LOG_LEVEL/);
  assert.throws(() => parseFoundationConfig({ VIPER_HOST: '' }), /VIPER_HOST/);
  assert.throws(() => parseFoundationConfig({ VIPER_HOST: 'bad host' }), /VIPER_HOST/);
});
