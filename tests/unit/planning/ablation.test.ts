import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planningCases } from '../../support/planning/scenarios.js';
import { pairedTrial } from '../../support/planning/ablation.js';

test('paired planning fixtures preserve decisions, arguments, input/approval and uncertain outcomes; all plan input overhead is accounted', async () => {
  for (const scenario of planningCases()) {
    const pair = await pairedTrial(scenario);
    assert.equal(pair.preserved, true); assert.equal(pair.delta.modelCalls, 0); assert.equal(pair.delta.toolCalls, 0);
    assert.ok(pair.delta.inputBytes > 0); assert.ok(pair.delta.estimatedInputTextTokens > 0);
    assert.ok(!JSON.stringify(pair.baseline.requests).includes('advisory_plan_v1'));
    assert.ok(JSON.stringify(pair.planned.requests).includes('advisory_plan_v1'));
  }
});
