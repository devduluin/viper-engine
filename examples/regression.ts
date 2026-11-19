import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { regressionSourceHashes, regressionManifest } from '../tests/support/regression/manifest.js';
import { changedSources } from '../tests/support/evaluation/snapshot.js';
import { runSuite } from '../tests/support/regression/suites.js';
import { engineTrials } from '../tests/support/regression/trials.js';
import { regressionResults } from '../tests/support/regression/report.js';
import { testServerConfig } from '../tests/integration/postgres/database.js';

const mode = process.argv[2];
if (mode !== 'offline' && mode !== 'postgres') throw new Error('Expected offline or postgres mode');
const extra = process.argv[3]; const repeats = extra === undefined ? 3 : Number(/^--repeats=(\d+)$/.exec(extra)?.[1]);
if (process.argv.length > 4 || !Number.isSafeInteger(repeats) || repeats < 1 || repeats > 3) throw new Error('Repeats must be1..3');
const id = `regression-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
const directory = path.join('artifacts/evals', id); mkdirSync(directory, { recursive: true });
const hashes = regressionSourceHashes(); const manifest = regressionManifest(mode, hashes);
writeFileSync(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
let fatal: string | undefined;
const suites: ReturnType<typeof runSuite>[] = [];
let trials: Awaited<ReturnType<typeof engineTrials>> = { records: [], cleanupErrors: [] };
try {
  if (mode === 'postgres') testServerConfig(); // Validate explicit loopback DB before invoking test children.
  for (const suite of (mode === 'postgres' ? ['unit', 'contract', 'integration'] : ['unit', 'contract']) as ('unit' | 'contract' | 'integration')[]) {
    console.log(`Regression ${suite} started; raw evidence: ${directory}`);
    suites.push(runSuite(suite, directory));
  }
  if (mode === 'postgres') {
    console.log(`Engine cold/warm trials started:10 cases x${repeats} repeats`);
    trials = await engineTrials(directory, repeats);
  }
} catch (error) {
  // Name + message (e.g. "Error: VIPER_TEST_DB_HOST is required"); test-DB/config messages carry no secrets.
  fatal = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 500) : 'UnknownError';
}
const sourceDrift = changedSources(hashes, regressionSourceHashes());
const results = regressionResults(suites, trials.records, mode, repeats);
const evidenceHashes = Object.fromEntries(readdirSync(directory).sort().map(name => [name,
  createHash('sha256').update(readFileSync(path.join(directory, name))).digest('hex')]));
const report = { schemaVersion: 1, id, createdAt: new Date().toISOString(), mode, repeats, ...results,
  passed: results.passed && fatal === undefined && sourceDrift.length === 0 && trials.cleanupErrors.length === 0,
  sourceDrift, cleanupErrors: trials.cleanupErrors, fatal, evidenceHashes };
writeFileSync(path.join(directory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ directory, passed: report.passed, suites: suites.map(suite => ({ suite: suite.suite, ...suite.counts, passed: suite.passed })),
  engineTrials: { passed: trials.records.filter(record => record.passed).length, expected: report.expectedTrials }, sourceDrift, fatal }));
process.exitCode = report.passed ? 0 : 1;
