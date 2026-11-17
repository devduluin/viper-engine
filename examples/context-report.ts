import { mkdirSync, writeFileSync } from 'node:fs';
import { runAgentLoop } from '../src/agent/runtime/run-loop.js';
import { estimateContextText } from '../src/agent/context/estimate.js';
import { harness, callsOf, finalText, StubMcp, success } from '../tests/unit/runtime/harness.js';
import { contextInput, policy } from '../tests/support/context/history.js';

// Reproducible offline ablation of one deterministic fixture. No provider, DB, key or environment.
async function run(compact: boolean) {
  const input = contextInput(); const mcp = new StubMcp(() => success({ stock: 5 }));
  const h = harness([callsOf(['read', 'lookup']), finalText('Stock is 5')], mcp, { input: {
    history: input.history, ...(compact ? { context: policy } : {}) } });
  const result = await runAgentLoop(h.input, h.deps);
  const requests = h.model.requests.map(request => ({ messages: request.messages.length,
    approximateTokens: estimateContextText(request).tokens, bytes: new TextEncoder().encode(JSON.stringify(request)).byteLength }));
  return { status: result.status, modelCalls: h.model.requests.length, toolCalls: mcp.calls.length,
    final: result.messages.at(-1)?.content, requests };
}
const baseline = await run(false); const compressed = await run(true);
if (baseline.status !== compressed.status || JSON.stringify(baseline.final) !== JSON.stringify(compressed.final)
  || baseline.modelCalls !== compressed.modelCalls || baseline.toolCalls !== compressed.toolCalls) throw new Error('Fixture behavior changed');
const report = { version: 1, fixture: 'P07-01 old turns plus active stock read', policy, baseline, compressed,
  quality: 'NOT_MEASURED', usage: 'Text estimates only; provider/media/billing and live-model quality not measured',
  summary: 'Deterministic incomplete excerpts; no summarizer model call', comparison: 'V4/Hermes NOT_MEASURED' };
mkdirSync('artifacts/context', { recursive: true });
writeFileSync('artifacts/context/p07-01.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
