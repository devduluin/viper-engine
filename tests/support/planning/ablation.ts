import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { runAgentLoop } from '../../../src/agent/runtime/run-loop.js';
import { estimateContextText } from '../../../src/agent/context/estimate.js';
import { createPlanEvidence } from '../../../src/bootstrap/planning.js';
import { harness, StubMcp } from '../../unit/runtime/harness.js';
import type { PlanningCase } from './scenarios.js';

async function trial(scenario: PlanningCase, planned: boolean) {
  const mcp = new StubMcp(() => scenario.outcome);
  const h = harness(scenario.frames, mcp, { input: { context: {} },
    deps: scenario.policy === undefined ? {} : { policy: scenario.policy } });
  const deps = planned ? { ...h.deps, contextEvidence: createPlanEvidence(h.input, scenario.plan) } : h.deps;
  const started = performance.now(); const result = await runAgentLoop(h.input, deps); const localMs = performance.now() - started;
  assert.equal(result.status, scenario.expected.status); assert.equal(h.model.requests.length, scenario.expected.modelCalls);
  assert.equal(mcp.calls.length, scenario.expected.toolCalls);
  const calls = mcp.calls.map(call => ({ tool: call.tool.name, arguments: call.arguments }));
  const requests = h.model.requests;
  return { status: result.status, final: result.messages.at(-1)?.content, calls, modelCalls: requests.length, toolCalls: mcp.calls.length,
    inputBytes: requests.reduce((sum, request) => sum + new TextEncoder().encode(JSON.stringify(request)).byteLength, 0),
    estimatedInputTextTokens: requests.reduce((sum, request) => sum + estimateContextText(request).tokens, 0), localMs, requests };
}
export async function pairedTrial(scenario: PlanningCase, plannedFirst = false) {
  const first = await trial(scenario, plannedFirst); const second = await trial(scenario, !plannedFirst);
  const baseline = plannedFirst ? second : first; const planned = plannedFirst ? first : second;
  assert.equal(planned.status, baseline.status); assert.deepEqual(planned.final, baseline.final); assert.deepEqual(planned.calls, baseline.calls);
  assert.equal(planned.modelCalls, baseline.modelCalls); assert.equal(planned.toolCalls, baseline.toolCalls);
  return { caseId: scenario.id, order: plannedFirst ? 'planned-first' : 'baseline-first', baseline, planned,
    delta: { inputBytes: planned.inputBytes - baseline.inputBytes, estimatedInputTextTokens: planned.estimatedInputTextTokens - baseline.estimatedInputTextTokens,
      modelCalls: planned.modelCalls - baseline.modelCalls, toolCalls: planned.toolCalls - baseline.toolCalls }, preserved: true };
}
