import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { listFiles, readJson, relativePath } from '../../scripts/lib/files.mjs';
import { fixtureValidators, assertSchema } from './schema.mjs';

export function createManifest(root) {
  const fixed = ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'evals/rubric.md'];
  const directories = ['src', 'scripts', 'evals/fixtures', 'evals/schemas', 'evals/support', 'evals/lib'];
  const filenames = [...fixed.map(name => path.join(root, name)), ...directories.flatMap(name => listFiles(path.join(root, name)))];
  const sourceSnapshot = Object.fromEntries(filenames.sort().map(filename => [
    relativePath(root, filename), createHash('sha256').update(fs.readFileSync(filename)).digest('hex'),
  ]));
  return {
    schemaVersion: 1,
    datasetVersion: 'foundation-v1',
    status: 'not_measured',
    engines: { viper_engine: 'not_measured', viper_v4: 'not_measured', hermes: 'not_measured' },
    model: null,
    budgets: { maxSteps: 5, maxToolCalls: 5, maxTimeMs: 30_000 },
    sourceSnapshot,
    datasetHashes: datasetHashes(root),
  };
}

export function verifyManifest(root) {
  const actual = readJson(path.join(root, 'evals/manifests/foundation.json'));
  assertSchema(fixtureValidators(root).manifest, actual, 'foundation manifest');
  if (!isDeepStrictEqual(actual.datasetHashes, datasetHashes(root))) {
    throw new Error('Foundation manifest drift. Review changed inputs, then run npm run eval:manifest. No scores are generated.');
  }
}

function datasetHashes(root) {
  const names = ['evals/fixtures', 'evals/schemas'];
  const files = [...names.flatMap(name => listFiles(path.join(root, name))), path.join(root, 'evals/rubric.md')];
  return Object.fromEntries(files.sort().map(filename => [
    relativePath(root, filename), createHash('sha256').update(fs.readFileSync(filename)).digest('hex'),
  ]));
}
