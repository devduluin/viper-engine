import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RunUsage } from '../../../src/contracts/models/run-usage.js';
import { engineCases } from './cases.js';
import { regressionFixture } from './fixture.js';
import { observeTrial } from './observe.js';
import { gradeTrial } from './grade.js';

export interface TrialRecord {
  readonly caseId: string; readonly repeat: number; readonly mode: 'cold' | 'warm'; readonly passed: boolean;
  readonly rawFile: string; readonly localMs?: number; readonly usage?: RunUsage; readonly modelCalls?: number;
  readonly toolCalls?: number; readonly catalogPages?: number; readonly status?: string; readonly error?: string;
}
export async function engineTrials(directory: string, repeats: number) {
  const records: TrialRecord[] = []; const cleanupErrors: string[] = [];
  for (const scenario of engineCases()) {
    for (let repeat = 0; repeat < repeats; repeat++) {
      const fixture = await regressionFixture(scenario).catch(() => undefined);
      for (const mode of ['cold', 'warm'] as const) {
        const rawFile = `${scenario.id}-${repeat}-${mode}.json`;
        try {
          if (fixture === undefined) throw new Error('Fixture setup failed');
          const observed = await observeTrial(fixture, scenario, mode, repeat); const grade = gradeTrial(scenario, observed);
          writeFileSync(path.join(directory, rawFile), `${JSON.stringify({ configuration: fixture.configuration, observed, grade }, null, 2)}\n`);
          records.push({ caseId: scenario.id, repeat, mode, rawFile, passed: grade.passed, localMs: observed.localMs,
            ...(observed.usage === undefined ? {} : { usage: observed.usage }), modelCalls: observed.modelCalls,
            toolCalls: observed.tools.length, catalogPages: observed.catalogPages, status: observed.status });
        } catch (error) {
          const name = error instanceof Error ? error.name : 'UnknownError';
          writeFileSync(path.join(directory, rawFile), JSON.stringify({ passed: false, error: name }));
          records.push({ caseId: scenario.id, repeat, mode, rawFile, passed: false, error: name });
        }
      }
      await fixture?.close().catch(() => { cleanupErrors.push(`${scenario.id}-${repeat}`); });
    }
  }
  return { records, cleanupErrors };
}
