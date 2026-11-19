import { spawnSync } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface TestSummary { readonly tests: number; readonly passed: number; readonly failed: number; readonly skipped: number; readonly cancelled: number }
export function tapSummary(output: string): TestSummary {
  const count = (name: string) => {
    const matches = [...output.matchAll(new RegExp(`^# ${name} (\\d+)\\s*$`, 'gm'))];
    if (matches.length !== 1) throw new Error(`Missing or ambiguous TAP summary: ${name}`);
    return Number(matches[0]![1]);
  };
  const summary = { tests: count('tests'), passed: count('pass'), failed: count('fail'), skipped: count('skipped'), cancelled: count('cancelled') };
  if (summary.tests < 1 || summary.tests !== summary.passed + summary.failed + summary.skipped + summary.cancelled) throw new Error('Invalid TAP counts');
  return summary;
}
export function suiteEnvironment(postgres: boolean) {
  return Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined
    && (/^(PATH|SystemRoot|WINDIR|TEMP|TMP|COMSPEC|PATHEXT)$/i.test(key) || (postgres && /^VIPER_TEST_DB_/.test(key)))));
}
export function runSuite(suite: 'unit' | 'contract' | 'integration', outputDirectory: string) {
  const root = path.resolve('tests', suite);
  const files = readdirSync(root, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile() && /\.test\.(ts|mjs)$/.test(entry.name))
    .map(entry => path.join(entry.parentPath, entry.name)).sort();
  if (files.length === 0) throw new Error('Refusing empty regression suite');
  const started = performance.now();
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=tap', '--test-concurrency=4', ...files],
    { encoding: 'utf8', env: suiteEnvironment(suite === 'integration'), timeout: 300000, maxBuffer: 16 * 1024 * 1024 });
  const output = `${child.stdout ?? ''}${child.stderr ?? ''}`; const filename = `${suite}.tap`;
  writeFileSync(path.join(outputDirectory, filename), output);
  let counts: TestSummary | undefined;
  try { counts = tapSummary(child.stdout ?? ''); } catch { /* Retain malformed/missing evidence as a failure. */ }
  const passed = child.status === 0 && child.error === undefined && counts !== undefined && counts.failed + counts.skipped + counts.cancelled === 0;
  return { suite, passed, localMs: performance.now() - started, exitCode: child.status, signal: child.signal,
    counts, files: files.map(file => path.relative('.', file).split(path.sep).join('/')), rawFile: filename,
    ...(child.error === undefined ? {} : { error: child.error.name }) };
}
