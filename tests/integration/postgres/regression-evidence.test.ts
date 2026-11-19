import assert from 'node:assert/strict';
import { test } from 'node:test';
import { engineCases } from '../../support/regression/cases.js';
import { regressionFixture } from '../../support/regression/fixture.js';
import { observeTrial } from '../../support/regression/observe.js';
import { gradeTrial } from '../../support/regression/grade.js';

test('cold/warm regression observations grade real SDK/MCP/database state for all10 fixed cases', async () => {
  for (const scenario of engineCases()) {
    const fixture = await regressionFixture(scenario);
    try {
      for (const mode of ['cold', 'warm'] as const) {
        const observed = await observeTrial(fixture, scenario, mode, 0);
        const grade = gradeTrial(scenario, observed);
        assert.equal(grade.passed, true, JSON.stringify({ caseId: scenario.id, mode, grade, status: observed.status,
          modelCalls: observed.modelCalls, tools: observed.tools, writes: observed.writes, toolCalls: observed.toolCalls }));
      }
    } finally { await fixture.close(); }
  }
});
