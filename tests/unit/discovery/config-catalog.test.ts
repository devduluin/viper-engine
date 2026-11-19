import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseToolDiscoveryConfig } from '../../../src/bootstrap/tool-discovery-config.js';
import { ToolDiscovery } from '../../../src/agent/discovery/controller.js';
import { TOOL_SEARCH_NAME } from '../../../src/contracts/discovery/state.js';
import { runtimeTool } from '../runtime/harness.js';
import { testContext, testScope } from '../../support/agent/setup.js';

const context = testContext();
const toolSet = (count: number) => Array.from({ length: count }, (_, i) => runtimeTool(`workin__item_${i}`));
test('environment switches auto/on/off and rejects invalid numeric bounds', () => {
  assert.equal(parseToolDiscoveryConfig({}).mode, 'auto');
  assert.equal(parseToolDiscoveryConfig({ VIPER_TOOL_DISCOVERY_MODE: 'off', VIPER_TOOL_EAGER_MAX_COUNT: '100' }).eagerMaxCount, 100);
  for (const env of [{ VIPER_TOOL_DISCOVERY_MODE: 'false' }, { VIPER_TOOL_SEARCH_TOP_K: '0' },
    { VIPER_TOOL_ACTIVE_MAX_TOKENS: '1e6' }, { VIPER_TOOL_CATALOG_MAX_TOOLS: '10001' }]) assert.throws(() => parseToolDiscoveryConfig(env));
});
test('auto uses count OR schema tokens, on defers, off preserves the complete catalog', () => {
  const create = (count: number, config: Parameters<typeof parseToolDiscoveryConfig>[0]) =>
    new ToolDiscovery(toolSet(count), context.scope, context.runId, parseToolDiscoveryConfig(config));
  assert.equal(create(2, {}).enabled, false);
  assert.equal(create(31, {}).index.modelTools.length, 1);
  assert.equal(create(2, { VIPER_TOOL_EAGER_MAX_TOKENS: '1' }).enabled, true);
  assert.equal(create(2, { VIPER_TOOL_DISCOVERY_MODE: 'on' }).index.modelTools[0]?.name, TOOL_SEARCH_NAME);
  assert.equal(create(400, { VIPER_TOOL_DISCOVERY_MODE: 'off' }).index.modelTools.length, 400);
});
test('catalog rejects a different owner, reserved alias and size overflow', () => {
  assert.throws(() => new ToolDiscovery(toolSet(2), testScope('other'), context.runId), /scope/i);
  assert.throws(() => new ToolDiscovery([runtimeTool(TOOL_SEARCH_NAME)], context.scope, context.runId), /Reserved/);
  assert.throws(() => new ToolDiscovery(toolSet(3), context.scope, context.runId, { catalogMaxTools: 2 }), /catalog limit/);
});
