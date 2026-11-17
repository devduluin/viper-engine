import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFixtures } from '../../../evals/lib/fixtures.mjs';
import { parseModelDecision } from '../../../src/contracts/models/decision.ts';

test('P00 scripted decisions remain compatible with the normalized model contract', () => {
  const { scenarios } = loadFixtures(process.cwd());
  let count = 0;
  for (const scenario of scenarios) {
    for (const response of scenario.modelResponses) {
      assert.equal(parseModelDecision(response).kind, response.kind);
      count++;
    }
  }
  assert.ok(count >= scenarios.length);
});
