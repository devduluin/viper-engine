import { readFileSync } from 'node:fs';
import { regressionSourceHashes } from '../regression/manifest.js';
import { sourceHashes } from '../evaluation/snapshot.js';
import { array, member, object, text } from './validation.js';
import { ENGINE_IDS } from './types.js';
import type { BaselineReference } from './analyze.js';

export function comparisonSourceHashes() { return { ...regressionSourceHashes(), ...sourceHashes('.', ['evals/comparison'], []) }; }
export function baselineReferences(): readonly BaselineReference[] {
  const data = object(JSON.parse(readFileSync('evals/comparison/baselines.json', 'utf8')));
  if (data['schemaVersion'] !== 1) throw new Error('Invalid baseline reference version');
  return array(data['references']).map(value => { const row = object(value);
    return { engine: member(row['engine'], ENGINE_IDS), version: text(row['version']), reason: text(row['reason']), source: text(row['source']) }; });
}
