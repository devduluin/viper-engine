import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { importEvidence } from '../tests/support/comparison/import.js';
import { comparisonReport } from '../tests/support/comparison/analyze.js';
import { baselineReferences, comparisonSourceHashes } from '../tests/support/comparison/manifest.js';
import { changedSources } from '../tests/support/evaluation/snapshot.js';
import { verifyFiles, evidenceBytes, digest } from '../tests/support/comparison/files.js';

const inputs = process.argv.slice(2);
if (inputs.length < 1 || inputs.length > 3) throw new Error('Usage: eval:compare <capture-directory> [capture-directory ...], at most3 distinct engines');
const hashes = comparisonSourceHashes(); const imported = inputs.map(importEvidence);
const result = comparisonReport(imported.map(item => item.evidence), baselineReferences());
for (const item of imported) verifyFiles(item.receipt.directory, item.receipt.hashes);
const drift = changedSources(hashes, comparisonSourceHashes());
if (drift.length > 0) throw new Error(`Comparison source drift: ${drift.join(', ')}`);
const directory = path.join('artifacts/evals', `comparison-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
mkdirSync(directory, { recursive: true });
writeFileSync(path.join(directory, 'inputs.json'), `${JSON.stringify(imported, null, 2)}\n`);
writeFileSync(path.join(directory, 'manifest.json'), `${JSON.stringify({ schemaVersion: 1, sourceHashes: hashes,
  statistics: { method: 'paired_task_percentile_bootstrap_live_only', seed: 17017, resamples: 5000 }, node: process.version,
  costPolicy: 'Billed-only ratio; estimates and unknown never treated as zero', externalRuntimeExecution: false }, null, 2)}\n`);
const evidenceHashes = Object.fromEntries(['inputs.json', 'manifest.json'].map(name => [name, digest(evidenceBytes(directory, name))]));
writeFileSync(path.join(directory, 'report.json'), `${JSON.stringify({ ...result, createdAt: new Date().toISOString(),
  evidenceHashes, disclosure: `${result.disclosure} External captures are data with provenance, not signed runtime attestations.` }, null, 2)}\n`);
console.log(JSON.stringify({ directory, status: result.status, suppliedEngines: result.suppliedEngines.map(item => item.engine),
  measuredTaskCells: result.coverage.reduce((sum, row) => sum + Object.values(row.engines).filter(cell => cell.status === 'pass' || cell.status === 'fail').length, 0),
  superiority: result.superiority, exitCode: result.status === 'comparable' ? 0 : 2 }));
process.exitCode = result.status === 'comparable' ? 0 : 2;
