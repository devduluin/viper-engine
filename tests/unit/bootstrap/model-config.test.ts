import assert from 'node:assert/strict';
import test from 'node:test';
import { parseModelConfig } from '../../../src/bootstrap/model-config.js';

const key = { ANTHROPIC_API_KEY: 'test-key' };

test('model config reads the key and defaults to claude-opus-5-5, medium effort, fallbacks on', () => {
  assert.deepEqual(parseModelConfig(key), {
    provider: 'anthropic', apiKey: 'test-key', model: 'claude-opus-5-5', effort: 'medium', fallbacks: true, maxRetries: 0,
  });
  const custom = parseModelConfig({ ...key, VIPER_MODEL: 'claude-sonnet-5-5', VIPER_MODEL_EFFORT: 'high', VIPER_MODEL_FALLBACKS: 'false', VIPER_MODEL_MAX_RETRIES: '0' });
  assert.deepEqual([custom.model, custom.effort, custom.fallbacks, custom.maxRetries], ['claude-sonnet-5-5', 'high', false, 0]);
});

test('missing key and invalid settings are rejected; the key never appears in errors', () => {
  assert.throws(() => parseModelConfig({}), /ANTHROPIC_API_KEY is required/);
  assert.throws(() => parseModelConfig({ ANTHROPIC_API_KEY: '  ' }), /ANTHROPIC_API_KEY is required/);
  for (const [name, value, pattern] of [['VIPER_MODEL_PROVIDER', 'openai', /Unsupported/], ['VIPER_MODEL', 'Bad Model', /Invalid VIPER_MODEL/],
    ['VIPER_MODEL_EFFORT', 'extreme', /VIPER_MODEL_EFFORT/], ['VIPER_MODEL_FALLBACKS', 'yes', /VIPER_MODEL_FALLBACKS/],
    ['VIPER_MODEL_MAX_RETRIES', '10', /VIPER_MODEL_MAX_RETRIES/]] as const) {
    assert.throws(() => parseModelConfig({ ANTHROPIC_API_KEY: 'secret-value', [name]: value }), (error: Error) =>
      pattern.test(error.message) && !error.message.includes('secret-value'));
  }
});
