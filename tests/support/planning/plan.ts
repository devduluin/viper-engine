import type { ContextPlan } from '../../../src/contracts/planning/plan.js';

export function checklist(objective = 'Complete the current request using observable evidence.'): ContextPlan {
  return { schemaVersion: 1, planId: 'fixture-checklist', revision: 1, objective, steps: [
    { id: 'inspect', goal: 'Read the current request and identify missing input.', evidence: 'Explicit user input and current conversation.', dependsOn: [] },
    { id: 'observe', goal: 'Read required data through available authorized MCP calls.', evidence: 'Successful tool results; report errors or uncertainty.', dependsOn: ['inspect'] },
    { id: 'finish', goal: 'Return the requested result with evidence and limitations.', evidence: 'Persisted outcomes; obtain separate approval for any proposed write.', dependsOn: ['observe'] },
  ] };
}
