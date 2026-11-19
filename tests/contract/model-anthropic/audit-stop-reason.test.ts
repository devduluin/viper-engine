import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FakeAnthropic } from '../../support/anthropic/fake-api.js';
import { modelRequest } from '../../support/anthropic/request.js';

test('contradictory Anthropic completion reasons never become executable tool calls or successful finals', async () => {
  const cases = [
    { stopReason: 'end_turn', blocks: [{ type: 'tool_use' as const, id: 'c', name: 'lookup', input: {} }] },
    { stopReason: 'tool_use', blocks: [{ type: 'text' as const, text: 'Finished without a tool' }] },
  ];
  for (const turn of cases) {
    const result = await new FakeAnthropic([turn]).gateway().generate(modelRequest());
    assert.ok(!result.ok && result.error.code === 'invalid_response');
    assert.equal(result.usage.source, 'provider');
  }
});
