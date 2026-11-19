import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { createFingerprint } from '../../../src/shared/fingerprints/fingerprint.js';
import { tapSummary } from '../regression/suites.js';
import { evidenceBytes, evidenceJson, verifyFiles, digest } from './files.js';
import { array, integer, member, object, parseComparisonEvidence, text } from './validation.js';
import { regressionTrial } from './regression-raw.js';
import type { Conditions } from './types.js';
import type { JsonObject } from '../../../src/contracts/messages/json.js';

const hash = (value: unknown) => createFingerprint(value, { domain: 'comparison.conditions', version: '1' });
function conditions(manifest: JsonObject, configuration: JsonObject): Conditions {
  const environment = object(manifest['environment']); const source = object(manifest['sourceHashes']);
  const budget = { limits: configuration['limits'], context: configuration['context'], maxModelCalls: configuration['maxModelCalls'],
    maxOutputTokens: configuration['maxOutputTokens'], requestTimeoutMs: configuration['requestTimeoutMs'] };
  return { dataset: hash(manifest['cases']), rubric: text(source['tests/support/regression/grade.ts']), tools: hash(configuration['catalog']),
    budget: hash(budget), model: hash({ generation: 'fixed-decisions-v1', cases: manifest['cases'] }),
    environment: hash({ platform: environment['platform'], arch: environment['arch'], release: environment['release'],
      cpu: environment['cpu'], engineTrialConcurrency: environment['engineTrialConcurrency'] }),
    latency: 'local-request-to-terminal-with-synthetic-control-v1', generation: 'scripted' };
}
function checkedSuites(directory: string, report: JsonObject, hashes: Readonly<Record<string, string>>) {
  const suites = array(report['suites']).map(object);
  if (!isDeepStrictEqual(suites.map(suite => suite['suite']).sort(), ['contract', 'integration', 'unit'])) throw new Error('Missing/duplicate regression suite');
  for (const value of suites) {
    const suite = object(value); const rawFile = text(suite['rawFile']);
    if (hashes[rawFile] === undefined) throw new Error('Unhashed suite evidence');
    if (!isDeepStrictEqual(tapSummary(evidenceBytes(directory, rawFile).toString('utf8')), suite['counts'])) throw new Error('TAP count mismatch');
  }
}
function stableCapture(report: JsonObject, manifest: JsonObject) {
  if (report['schemaVersion'] !== 1 || manifest['schemaVersion'] !== 1) throw new Error('Unsupported regression version');
  if (manifest['task'] !== 'P08-01' || report['mode'] !== 'postgres' || manifest['mode'] !== 'postgres') throw new Error('Comparison requires full PostgreSQL regression evidence');
  if (array(report['sourceDrift']).length > 0 || array(report['cleanupErrors']).length > 0 || report['fatal'] !== undefined) throw new Error('Unstable/incomplete regression capture');
}
function rawTasks(directory: string, manifest: JsonObject, records: readonly JsonObject[], repeats: number, hashes: Readonly<Record<string, string>>) {
  let config: JsonObject | undefined;
  const tasks = array(manifest['cases']).map(value => {
    const scenario = object(value); const id = text(scenario['id']); const selected = records.filter(record => record['caseId'] === id);
    const expected = Array.from({ length: repeats }, (_, repeat) => [`${repeat}/cold`, `${repeat}/warm`]).flat().sort();
    if (!isDeepStrictEqual(selected.map(record => `${record['repeat']}/${record['mode']}`).sort(), expected)) throw new Error('Incomplete regression task');
    const trials = selected.map(record => {
      const name = text(record['rawFile']); if (hashes[name] === undefined) throw new Error('Unhashed trial evidence');
      const raw = evidenceJson(directory, name); const current = object(raw['configuration']);
      if (config === undefined) config = current;
      else if (!isDeepStrictEqual(conditions(manifest, config), conditions(manifest, current))) throw new Error('Within-run conditions drift');
      return regressionTrial(raw, record);
    });
    return { id, family: text(scenario['family']), split: 'development', status: 'measured', reason: 'Verified scripted regression capture', trials };
  });
  if (config === undefined || tasks.length * repeats * 2 !== records.length) throw new Error('Empty/extra regression task evidence');
  return { tasks, config };
}
export function importRegression(directory: string) {
  const report = evidenceJson(directory, 'report.json'); const manifest = evidenceJson(directory, 'manifest.json');
  stableCapture(report, manifest);
  const hashes = verifyFiles(directory, report['evidenceHashes']);
  if (hashes['manifest.json'] === undefined) throw new Error('Unhashed regression manifest');
  checkedSuites(directory, report, hashes);
  const records = array(report['records']).map(object); const repeats = integer(report['repeats']);
  if (repeats < 1 || repeats > 30 || records.length !== integer(report['expectedTrials'])) throw new Error('Missing regression trials');
  const { tasks, config } = rawTasks(directory, manifest, records, repeats, hashes);
  const sources = object(manifest['sourceHashes']);
  if (!Object.keys(sources).some(name => name.startsWith('src/')) || Object.values(sources).some(value => typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value))) throw new Error('Invalid source pin');
  const evidence = parseComparisonEvidence({ schemaVersion: 1, engine: 'viper-engine', version: hash(Object.fromEntries(Object.entries(sources).filter(([name]) => name.startsWith('src/')))),
    datasetVersion: text(manifest['datasetVersion']), conditions: conditions(manifest, config), tasks,
    capabilities: array(report['critical']).map(value => { const row = object(value); return { id: text(row['invariant']),
      status: member(row['status'], ['PASS', 'FAIL']) === 'PASS' ? 'pass' : 'fail', reason: 'Full deterministic suite capture; raw TAP verified' }; }),
    provenance: 'P08-01 raw checksums/TAP/grade bindings verified; scripted counters, no live semantic score' });
  return { evidence, receipt: { directory: path.resolve(directory), hashes: { ...hashes, 'report.json': digest(evidenceBytes(directory, 'report.json')) } } };
}
