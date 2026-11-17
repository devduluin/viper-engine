import assert from 'node:assert/strict';
import test from 'node:test';
import { initialState, encodeState, decodeState } from '../../../src/application/durable/state.js';
import { RunBudget } from '../../../src/agent/policies/budget.js';
import { DEFAULT_RUN_LIMITS } from '../../../src/agent/policies/limits.js';
import { indexTools } from '../../../src/agent/execution/tool-catalog.js';
import { parseId } from '../../../src/contracts/identity/ids.js';
import { testScope } from '../../support/agent/setup.js';
import { runtimeTool } from '../runtime/harness.js';

test('versioned state round trips ceilings, deadline and counters and rejects invalid recovery data', () => {
  const state = initialState({ model: 'scripted', maxModelCalls: 4, maxOutputTokens: 100 }, 1000);
  const encoded = encodeState(state);
  assert.deepEqual(decodeState(encoded), state);
  assert.equal(Object.isFrozen(encoded), true);
  for (const patch of [{ version: 2 }, { modelCalls: -1 }, { maxModelCalls: 0 }, { phase: 'unrecognized' }]) {
    assert.throws(() => decodeState({ ...encoded, ...patch }));
  }
});

test('repetition, reserved IDs and unknown fingerprints survive immutable budget serialization', () => {
  const scope = testScope(); const runId = parseId('run', 'budget-state');
  const index = indexTools([runtimeTool('lookup')], scope);
  const budget = new RunBudget(DEFAULT_RUN_LIMITS, scope, runId);
  const id = parseId('tool_call', 'unknown-first');
  budget.step(); budget.propose([{ id, name: 'lookup', arguments: { a: 1 } }], index); budget.recordUnknown(id);
  const state = budget.exportState();
  const restored = new RunBudget(DEFAULT_RUN_LIMITS, scope, runId, state);
  const next = parseId('tool_call', 'unknown-next');
  restored.propose([{ id: next, name: 'lookup', arguments: { a: 1 } }], index);
  assert.equal(restored.isUncertain(next), true);
  assert.deepEqual(state, budget.exportState());
  assert.equal(restored.snapshot().steps, 1);
  assert.equal(restored.snapshot().toolCalls, 2);
});
