import { existsSync } from 'node:fs';
import path from 'node:path';
import { evidenceBytes, evidenceJson, verifyFiles, digest } from './files.js';
import { parseComparisonEvidence } from './validation.js';
import { importRegression } from './regression-import.js';

/** Data-only external capture: no commands, plugins, code imports or network activity. */
export function importEvidence(directory: string) {
  if (!existsSync(path.join(directory, 'comparison-evidence.json'))) return importRegression(directory);
  const bundle = evidenceJson(directory, 'comparison-evidence.json');
  if (Object.keys(bundle).some(key => !['schemaVersion', 'evidence', 'artifacts'].includes(key))) throw new Error('Unknown capture envelope field');
  if (bundle['schemaVersion'] !== 1) throw new Error('Unsupported evidence envelope');
  const hashes = verifyFiles(directory, bundle['artifacts']);
  const evidence = parseComparisonEvidence(bundle['evidence']);
  return { evidence, receipt: { directory: path.resolve(directory),
    hashes: { ...hashes, 'comparison-evidence.json': digest(evidenceBytes(directory, 'comparison-evidence.json')) } } };
}
