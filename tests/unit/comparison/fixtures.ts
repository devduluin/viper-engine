import type { ComparisonEvidence, ComparisonTrial, EngineId } from '../../support/comparison/types.js';

export function observation(repeat = 0): ComparisonTrial {
  return { repeat, mode: 'cold', passed: true, criticalFailure: false, latencyMs: 10, modelCalls: 1, toolCalls: 0,
    costUsd: null, costProvenance: 'unavailable' };
}
/** Synthetic unit data only; never exported as an actual Hermes/V4 execution capture. */
export function capture(engine: EngineId): ComparisonEvidence {
  return { schemaVersion: 1, engine, version: 'synthetic-unit-fixture', datasetVersion: 'unit-v1',
    conditions: { dataset: 'a'.repeat(64), rubric: 'b'.repeat(64), tools: 'c'.repeat(64), budget: 'd'.repeat(64), model: 'e'.repeat(64),
      environment: 'f'.repeat(64), latency: 'unit-local-v1', generation: 'scripted' },
    tasks: [0, 1].map(id => ({ id: `case-${id}`, family: 'unit', split: 'development', status: 'measured', reason: 'Synthetic unit data',
      trials: [0, 1, 2].flatMap(repeat => [observation(repeat), { ...observation(repeat), mode: 'warm' }]) })),
    capabilities: [{ id: 'unit-capability', status: 'pass', reason: 'Synthetic unit only' }], provenance: 'SYNTHETIC TEST ONLY; no baseline engine was executed' };
}
