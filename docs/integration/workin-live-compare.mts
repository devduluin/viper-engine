// Compare two workin-live reports (e.g. before/after P07-04, or Opus vs Sonnet).
//
//   node --import tsx docs/integration/workin-live-compare.mts <base report.json> <candidate report.json>
//
// Prints what differs in the pinned manifests (a difference you did not intend makes the comparison
// unfair), then per-case pass rate, regressions/improvements and usage. Older reports without a
// manifest or trials are read as one trial per case. Nothing is written.
// REGRADE=1 re-grades both reports' stored observations with the current cases.json rules, so a report
// graded under an older (looser) rule is compared fairly. ALL=1 lists every case, not only changes.
import { readFileSync } from 'node:fs';
import { grade } from './workin-live-grade.mts';
import type { Expect } from './workin-live-grade.mts';

type Row = Record<string, unknown>;
interface CaseSummary { id: string; family: string; trials: number; passes: number; passRate: number }

const [baseFile, candidateFile] = process.argv.slice(2);
if (!baseFile || !candidateFile) throw new Error('usage: workin-live-compare.mts <base report.json> <candidate report.json>');
const expectations = new Map(((JSON.parse(readFileSync('evals/datasets/workin-live/cases.json', 'utf8')) as Row).cases as Row[])
  .map((c) => [String(c.id), c.expect as Expect]));

/** Re-grade stored observations (status/tools/answer/approvals) with today's rules; run errors and removed cases are kept. */
function regrade(report: Row): Row {
  const results = ((report.results ?? []) as Row[]).map((r) => {
    const expect = expectations.get(String(r.id));
    if (expect === undefined || JSON.stringify(r.failures ?? []).includes('run error')) return r;
    const failures = grade(expect, { status: String(r.status), tools: (r.tools ?? []) as string[], answer: String(r.answer ?? ''), approvals: (r.approvals ?? []) as string[] });
    return { ...r, pass: failures.length === 0, failures };
  });
  return { ...report, results, byCase: undefined };
}
const read = (file: string) => {
  const report = JSON.parse(readFileSync(file, 'utf8')) as Row;
  return process.env.REGRADE === '1' ? regrade(report) : report;
};
const base = read(baseFile);
const candidate = read(candidateFile);

function byCase(report: Row): Map<string, CaseSummary> {
  if (Array.isArray(report.byCase)) return new Map((report.byCase as CaseSummary[]).map((c) => [c.id, c]));
  const map = new Map<string, CaseSummary>();
  for (const r of (report.results ?? []) as Row[]) {
    const id = String(r.id);
    const current = map.get(id) ?? { id, family: String(r.family), trials: 0, passes: 0, passRate: 0 };
    current.trials += 1; current.passes += r.pass ? 1 : 0; current.passRate = current.passes / current.trials;
    map.set(id, current);
  }
  return map;
}

/** Leaf paths whose values differ; tool lists are compared by their hash, run timestamps are ignored. */
const IGNORED = new Set(['createdAt', 'dataset.cases', 'dataset.trials', 'gateway.catalog.tools']);
const isRecord = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value);
const show = (value: unknown) => JSON.stringify(value) ?? '—';

function diff(a: unknown, b: unknown, prefix = '', out: string[] = []): string[] {
  if (IGNORED.has(prefix)) return out;
  if (!isRecord(a) || !isRecord(b)) {
    if (show(a) !== show(b)) out.push(`${prefix}: ${show(a)} → ${show(b)}`);
    return out;
  }
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[key], b[key], prefix ? `${prefix}.${key}` : key, out);
  return out;
}

function catalogChanges(a: Row | undefined, b: Row | undefined): string[] {
  const tools = (m: Row | undefined) => new Map((((m?.gateway as Row)?.catalog as Row)?.tools as Row[] ?? []).map((t) => [String(t.name), String(t.sha256)]));
  const [x, y] = [tools(a), tools(b)];
  const out: string[] = [];
  for (const [name, hash] of y) if (!x.has(name)) out.push(`+ ${name}`); else if (x.get(name) !== hash) out.push(`~ ${name} (description/schema changed)`);
  for (const name of x.keys()) if (!y.has(name)) out.push(`- ${name}`);
  return out;
}

const pct = (value: number) => `${Math.round(value * 100)}%`;
const label = (report: Row) => {
  const model = (report.model ?? {}) as Row;
  return `${String(report.reportId)} (${String(model.model ?? '?')}, effort ${String(model.effort ?? '?')})`;
};

console.log(`base:      ${label(base)}`);
console.log(`candidate: ${label(candidate)}`);
console.log(process.env.REGRADE === '1' ? 'grading: re-graded with current cases.json\n' : 'grading: as stored in each report (REGRADE=1 to re-grade)\n');

const [mBase, mCand] = [base.manifest as Row | undefined, candidate.manifest as Row | undefined];
if (mBase === undefined || mCand === undefined) {
  console.log('manifest: missing in at least one report (pre-manifest run) — differences cannot be verified.\n');
} else {
  const changes = diff(mBase, mCand);
  console.log(changes.length === 0 ? 'manifest: identical' : `manifest differences (${changes.length}):`);
  for (const change of changes) console.log(`  ${change.length > 160 ? `${change.slice(0, 157)}...` : change}`);
  const tools = catalogChanges(mBase, mCand);
  if (tools.length > 0) console.log(`tool catalog: ${tools.join(', ')}`);
  console.log('');
}

const [a, b] = [byCase(base), byCase(candidate)];
const ids = [...new Set([...a.keys(), ...b.keys()])].sort();
const rows: string[][] = [['case', 'family', 'base', 'candidate', '']];
let regressions = 0; let improvements = 0;
for (const id of ids) {
  const x = a.get(id); const y = b.get(id);
  let mark = '';
  if (x && y && y.passRate < x.passRate) { mark = 'REGRESSION'; regressions += 1; }
  if (x && y && y.passRate > x.passRate) { mark = 'improved'; improvements += 1; }
  if (!x || !y) mark = !x ? 'new' : 'not run';
  if (mark !== '' || process.env.ALL === '1') {
    rows.push([id, (x ?? y)!.family, x ? `${x.passes}/${x.trials}` : '—', y ? `${y.passes}/${y.trials}` : '—', mark]);
  }
}
const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)));
if (rows.length > 1) for (const row of rows) console.log(row.map((cell, i) => cell.padEnd(widths[i]!)).join('  ').trimEnd());
else console.log('no per-case changes (ALL=1 lists every case)');

const common = ids.filter((id) => a.has(id) && b.has(id));
const rate = (map: Map<string, CaseSummary>) => common.reduce((sum, id) => sum + map.get(id)!.passRate, 0) / Math.max(common.length, 1);
const totals = (report: Row) => (report.totals ?? {}) as Row;
const perRun = (report: Row, key: string) => Number(totals(report)[key] ?? 0) / Math.max(Number(totals(report).runs ?? (report.results as unknown[] | undefined)?.length ?? 1), 1);
console.log(`\ncommon cases ${common.length}: mean pass rate ${pct(rate(a))} → ${pct(rate(b))}; ${regressions} regression(s), ${improvements} improvement(s)`);
console.log(`per run: model calls ${perRun(base, 'calls').toFixed(1)} → ${perRun(candidate, 'calls').toFixed(1)}, `
  + `tokens in ${Math.round(perRun(base, 'input'))} → ${Math.round(perRun(candidate, 'input'))}, `
  + `out ${Math.round(perRun(base, 'output'))} → ${Math.round(perRun(candidate, 'output'))}, `
  + `seconds ${perRun(base, 'seconds').toFixed(1)} → ${perRun(candidate, 'seconds').toFixed(1)}`);
if (common.length > 0 && Math.min(...common.map((id) => Math.min(a.get(id)!.trials, b.get(id)!.trials))) < 3) {
  console.log('note: fewer than 3 trials per case on at least one side; single flips may be noise.');
}
