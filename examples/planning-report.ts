import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { join, sep } from 'node:path';
import { planningCases } from '../tests/support/planning/scenarios.js';
import { pairedTrial } from '../tests/support/planning/ablation.js';

// Predeclared synthetic scripts; model responses do NOT adapt to checklist presence.
// This measures invariants and context overhead, never live-model quality or billing.
const cases = planningCases(); const trials: (Awaited<ReturnType<typeof pairedTrial>> & { readonly repeat: number })[] = [];
for (const scenario of cases) {
  for (let repeat = 0; repeat < 3; repeat++) trials.push({ repeat, ...await pairedTrial(scenario, repeat % 2 === 1) });
}
const files = [...['src', 'tests/support'].flatMap(root => readdirSync(root, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name))), 'examples/planning-report.ts',
  'tests/unit/runtime/harness.ts', 'package.json', 'package-lock.json'].sort();
const hashes = Object.fromEntries(files.map(file => [file.split(sep).join('/'), createHash('sha256').update(readFileSync(file)).digest('hex')]));
const raw = JSON.stringify(trials, null, 2);
const totals = (key: 'baseline' | 'planned') => trials.reduce((sum, trial) => ({ modelCalls: sum.modelCalls + trial[key].modelCalls,
  toolCalls: sum.toolCalls + trial[key].toolCalls, inputBytes: sum.inputBytes + trial[key].inputBytes,
  estimatedInputTextTokens: sum.estimatedInputTextTokens + trial[key].estimatedInputTextTokens }),
{ modelCalls: 0, toolCalls: 0, inputBytes: 0, estimatedInputTextTokens: 0 });
const report = { schemaVersion: 1, task: 'P07-04', mode: 'offline-scripted-ablation', createdAt: new Date().toISOString(),
  environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model },
  design: { uniqueCases: cases.length, pairs: trials.length, variantsPerPair: 2, repeatsPerCase: 3, order: 'baseline/planned alternated',
    responses: 'Fixed independently of plan presence; repeated pairs are not independent tasks',
    latency: 'localMs records local scripted runtime only; no provider/network latency or cold/warm claim',
    selection: 'simple, dependent reads, missing input, approval, unknown and failed tool; not tuned on live results' },
  quality: { scriptedInvariantPairsPassed: trials.filter(trial => trial.preserved).length, liveSemanticBenefit: 'NOT_MEASURED',
    interpretation: 'Identical fixed model decisions cannot establish model quality improvement' },
  usage: { baseline: totals('baseline'), planned: totals('planned'), source: 'text-estimates-and-internal-JSON-bytes', providerUsage: 'NOT_MEASURED', billing: 'NOT_MEASURED' },
  cases: cases.map(scenario => ({ id: scenario.id, expected: scenario.expected, plan: scenario.plan })),
  decision: { feature: 'explicit-opt-in-only', default: 'off', automaticPlanning: 'DEFERRED',
    reason: 'No measured live semantic benefit; checklist increases input context. Baseline simple loop remains default.' },
  comparison: 'V4/Hermes NOT_MEASURED', hashes, rawSha256: createHash('sha256').update(raw).digest('hex'),
  exclusions: ['No live provider, DB or external MCP', 'No live semantic quality, cold/warm latency, billing or stochastic confidence interval',
    'No automatic planner, persistent plan progress, executable playbook, learning proposal promotion or desktop'] };
mkdirSync('artifacts/planning', { recursive: true });
writeFileSync('artifacts/planning/p07-04-trials.json', raw);
writeFileSync('artifacts/planning/p07-04.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ pairs: report.design.pairs, quality: report.quality, usage: report.usage, decision: report.decision }));
