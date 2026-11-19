import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ToolDiscovery } from '../../../src/agent/discovery/controller.js';
import { runtimeTool } from '../runtime/harness.js';
import { testContext, testScope } from '../../support/agent/setup.js';
import { parseToolDiscoveryState } from '../../../src/contracts/discovery/state.js';

const context = testContext();
const catalog = [runtimeTool('workin__payroll'), runtimeTool('margin__journal'), runtimeTool('workin__attendance')];
test('search loads matching schemas and respects source/active/search budgets', () => {
  const subject = new ToolDiscovery(catalog, context.scope, context.runId, { mode: 'on', searchTopK: 1, maxSearchCalls: 2 });
  assert.equal(subject.index.find('margin__journal'), undefined);
  assert.deepEqual(subject.search({ query: 'payroll' })['loaded'], ['workin__payroll']);
  assert.equal(subject.index.modelTools.length, 2);
  assert.equal(subject.search({ query: 'journal', source: 'workin' })['code'], 'no_matches');
  assert.equal(subject.search({ query: 'journal' })['code'], 'search_limit');
  assert.equal(subject.index.find('margin__journal'), undefined);
  const tooSmall = new ToolDiscovery(catalog, context.scope, context.runId, { mode: 'on', activeMaxTokens: 1 });
  assert.deepEqual(tooSmall.search({ query: 'payroll' })['skipped'], ['workin__payroll']);
  assert.equal(tooSmall.index.modelTools.length, 1);
});
test('saved settings survive config changes but different owner and changed versions grant no access', () => {
  const subject = new ToolDiscovery(catalog, context.scope, context.runId, { mode: 'on' });
  subject.search({ query: 'payroll' }); const saved = subject.snapshot();
  const restored = new ToolDiscovery(catalog, context.scope, context.runId, { mode: 'off' }, saved);
  assert.equal(restored.enabled, true); assert.ok(restored.index.find('workin__payroll'));
  assert.throws(() => new ToolDiscovery(catalog, testScope('other'), context.runId, {}, saved));
  const changed = catalog.map(tool => ({ ...tool, definition: { ...tool.definition, ref: { ...tool.definition.ref, definitionVersion: 'new' } } }));
  assert.equal(new ToolDiscovery(changed, context.scope, context.runId, {}, saved).index.find('workin__payroll'), undefined);
  assert.throws(() => parseToolDiscoveryState({ ...saved, searches: -1 }));
});
test('3000 distractors stay outside model context while an exact workflow match is discoverable', () => {
  const distractors = Array.from({ length: 3000 }, (_, i) => runtimeTool(`workin__unrelated_${i}`));
  const subject = new ToolDiscovery([...distractors, ...catalog], context.scope, context.runId, { mode: 'auto', searchTopK: 1 });
  assert.equal(subject.index.modelTools.length, 1);
  assert.deepEqual(subject.search({ query: 'journal', source: 'margin' })['loaded'], ['margin__journal']);
  assert.equal(subject.index.modelTools.length, 2);
});
