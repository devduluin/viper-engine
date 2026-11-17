import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlanEvidence } from '../../../src/bootstrap/planning.js';
import { checklist } from '../../support/planning/plan.js';
import { testContext, testScope } from '../../support/agent/setup.js';
import { parseId } from '../../../src/contracts/identity/ids.js';
import { parseContextPlan } from '../../../src/contracts/planning/validation.js';

const options = () => ({ signal: new AbortController().signal });
test('plan evidence is exact owner/app/tenant/conversation/run scoped and honours cancellation', async () => {
  const context = testContext(); const provider = createPlanEvidence(context, checklist());
  const messages = await provider(context, options()); assert.equal(messages.length, 1); assert.equal(messages[0]?.role, 'user');
  for (const scope of [testScope('other'), testScope('actor-a', 'other'), testScope('actor-a', 'app-a', 'tenant')]) {
    assert.deepEqual(await provider({ ...context, scope }, options()), []);
  }
  assert.deepEqual(await provider({ ...context, runId: parseId('run', 'other') }, options()), []);
  assert.deepEqual(await provider({ ...context, conversationId: parseId('conversation', 'other') }, options()), []);
  const aborted = new AbortController(); aborted.abort(new Error('host cancelled'));
  await assert.rejects(provider(context, { signal: aborted.signal }), /host cancelled/);
  const forged = structuredClone(context.scope);
  assert.throws(() => createPlanEvidence({ ...context, scope: forged }, checklist()), /authentication/);
  await assert.rejects(provider({ ...context, scope: forged }, options()), /authentication/);
});

test('evidence takes immutable snapshots; scope symbols are not fingerprint input and revisions change the message ID', async () => {
  const context = testContext(); const plan = { ...checklist(), steps: checklist().steps.map(step => ({ ...step })) };
  const binding = { scope: context.scope, runId: context.runId, conversationId: context.conversationId };
  const provider = createPlanEvidence(binding, plan); const before = await provider(context, options());
  plan.steps[0]!.goal = 'MUTATED_AFTER_CREATE'; binding.runId = parseId('run', 'mutated');
  assert.deepEqual(await provider(context, options()), before); assert.ok(!JSON.stringify(before).includes('MUTATED_AFTER_CREATE'));
  assert.ok(Object.isFrozen(before) && Object.isFrozen(before[0]?.content));
  const next = await createPlanEvidence(context, { ...checklist(), revision: 2 })(context, options());
  assert.notEqual(next[0]?.id, before[0]?.id); assert.match(JSON.stringify(before), /advisory_plan_v1/);
});

test('escaped payload is bounded again after nesting into an evidence message', () => {
  const plan = { ...checklist(), steps: [0, 1].map(i => ({ id: `step-${i}`, goal: '\\'.repeat(512), evidence: '\\'.repeat(512), dependsOn: [] })) };
  assert.equal(parseContextPlan(plan).steps.length, 2);
  assert.throws(() => createPlanEvidence(testContext(), plan), /message byte limit/);
});
