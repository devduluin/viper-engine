import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseConfiguredModelConfig, createConfiguredModelBinding } from '../../src/bootstrap/configured-model.js';

test('provider composition preserves explicit config and constructs clients without sending requests', () => {
  const anthropic = parseConfiguredModelConfig({ ANTHROPIC_API_KEY: 'not-a-real-key', VIPER_MODEL: 'configured-model' });
  const openai = parseConfiguredModelConfig({ VIPER_MODEL_PROVIDER: ' openai ', OPENAI_API_KEY: 'not-a-real-key',
    VIPER_OPENAI_MODEL: 'configured-chat-model' });
  for (const config of [anthropic, openai]) {
    assert.equal(config.maxRetries, 0);
    const binding = createConfiguredModelBinding(config, { now: () => Date.now() });
    assert.equal(binding.provider, config.provider);
    assert.equal(binding.model, config.model);
    assert.ok(Object.isFrozen(binding));
  }
  assert.throws(() => parseConfiguredModelConfig({ VIPER_MODEL_PROVIDER: 'PRIVATE_VALUE' }), /^Error: Unsupported model provider$/);
  assert.throws(() => parseConfiguredModelConfig({ VIPER_MODEL_PROVIDER: 'openai', OPENAI_API_KEY: 'not-a-real-key' }), /VIPER_OPENAI_MODEL/);
});
