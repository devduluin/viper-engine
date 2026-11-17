import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseContextPlan } from '../../../src/contracts/planning/validation.js';
import { checklist } from '../../support/planning/plan.js';

test('plans reject execution/grant/completion fields, unsupported versions and malformed JSON containers', () => {
  const plan = checklist();
  for (const extra of [{ executable: true }, { approved: true }, { actorId: 'other' }, { schemaVersion: 2 }, { revision: 0 }]) {
    assert.throws(() => parseContextPlan({ ...plan, ...extra }));
  }
  assert.throws(() => parseContextPlan({ ...plan, steps: [{ ...plan.steps[0], status: 'completed' }] }));
  assert.throws(() => parseContextPlan(Object.assign(Object.create({}), plan)));
  assert.throws(() => parseContextPlan({ ...plan, [Symbol('hidden')]: 'grant' }));
  assert.throws(() => parseContextPlan({ ...plan, steps: new Array(3) }));
});

test('step dependencies are bounded, unique and acyclic with prior-only references', () => {
  const plan = checklist(); const first = plan.steps[0]!;
  for (const steps of [[], Array.from({ length: 9 }, (_, i) => ({ ...first, id: `step-${i}` })),
    [first, first], [{ ...first, dependsOn: ['inspect'] }], [{ ...first, dependsOn: ['future'] }],
    [first, { ...first, id: 'second', dependsOn: ['inspect', 'inspect'] }]]) assert.throws(() => parseContextPlan({ ...plan, steps }));
  const parsed = parseContextPlan(plan); assert.equal(parsed.steps.length, 3);
  assert.ok(Object.isFrozen(parsed) && Object.isFrozen(parsed.steps) && Object.isFrozen(parsed.steps[1]?.dependsOn));
});

test('plan text and total serialized size use UTF8 byte bounds with valid Unicode', () => {
  const plan = checklist(); const first = plan.steps[0]!;
  assert.equal(parseContextPlan({ ...plan, objective: '🦊'.repeat(128) }).objective, '🦊'.repeat(128));
  for (const objective of ['', ' \n ', '🦊'.repeat(129), '\u0000', '\uD800', '\uDFFF']) assert.throws(() => parseContextPlan({ ...plan, objective }));
  const steps = Array.from({ length: 8 }, (_, i) => ({ ...first, id: `step-${i}`, goal: 'a'.repeat(512), evidence: 'b'.repeat(512) }));
  assert.throws(() => parseContextPlan({ ...plan, steps }), /byte limit/);
});
