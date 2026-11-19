import type { EngineCase } from './cases.js';
import { anthropic } from '../../integration/postgres/engine-fixtures.js';
import { ScriptedModel } from '../agent/scripted-model.js';
import { decided, finalText } from '../../unit/runtime/harness.js';

export function regressionModel(scenario: EngineCase) {
  if (scenario.control === 'input') {
    const frames = [decided({ kind: 'needs_input', question: 'Which record?' }), finalText('Record a confirmed')];
    const gateway = new ScriptedModel([...frames, ...frames].map(result => ({ result })), { now: Date.now });
    return { model: { provider: 'scripted-port', model: 'scripted-clarification', gateway },
      requests: () => gateway.requests, provenance: 'scripted_port_usage_unavailable' };
  }
  const { model, api } = anthropic([...scenario.replies, ...scenario.replies]);
  return { model, requests: () => api.bodies, provenance: 'real_sdk_with_scripted_fetch_usage_not_billable' };
}
