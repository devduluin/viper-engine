import { sourceHashes } from '../evaluation/snapshot.js';

/** Actual source/support bytes; captures before and after a report to refuse concurrent drift. */
export function planningSourceHashes() {
  return sourceHashes('.', ['src', 'tests/support'], ['examples/planning-report.ts',
    'tests/unit/runtime/harness.ts', 'package.json', 'package-lock.json']);
}
