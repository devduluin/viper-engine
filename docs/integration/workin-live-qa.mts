// QA report for human review from workin-live reports: question, expectation, Viper's answer, tools,
// verdict and a reviewer checkbox per case. Paired runs (e.g. cache off/on) are shown side by side.
//
//   node --import tsx docs/integration/workin-live-qa.mts --out docs/qa/workin-live/<name> --title "<title>" \
//     <label>=<report.json> [<label>=<report.json> ...]
//
// Writes README.md (summary) plus cases-NN.md (each under the 300-line Markdown limit) and a trimmed
// report-<label>.json per run (no event logs) so the baseline stays in git; artifacts/ is not committed.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

interface Expect { status: string[]; toolsAll?: string[]; toolsAny?: string[]; answerAll?: string[][]; answerNone?: string[]; approval?: string | null }
interface CaseDef { id: string; family: string; question?: string; turns?: string[]; approvalDecision?: string; note?: string; expect: Expect }
interface Usage { calls?: number; input?: number; output?: number; cacheRead?: number; cacheWrite?: number }
interface Result { id: string; pass: boolean; status: string; tools: string[]; approvals: string[]; failures: string[]; answer?: string; seconds: number; usage?: Usage; events?: unknown }
interface Service { commit?: string; dirty?: string[] }
interface Manifest {
  engine?: { src?: { sha256?: string } }; dataset?: { sha256?: string }; services?: Record<string, Service>;
  gateway?: { catalog?: { count?: number; tokens?: { catalogTokens?: number } } };
}
interface Report { totals: Record<string, number>; model?: Record<string, string>; manifest?: Manifest; results: Result[] }
interface Run { label: string; file: string; report: Report; byId: Map<string, Result> }

const MAX_LINES = 280;
const ANSWER_CHARS = 900;
const ANSWER_LINES = 12;

function parseArgs(argv: string[]) {
  const value = (flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  const out = value('--out'); const title = value('--title') ?? 'Workin live QA';
  const runs = argv.filter((arg, i) => arg.includes('=') && !['--out', '--title'].includes(argv[i - 1] ?? ''));
  if (!out || runs.length === 0) throw new Error('usage: workin-live-qa.mts --out <dir> [--title <t>] <label>=<report.json> ...');
  return { out, title, runs: runs.map((arg) => { const [label, file] = arg.split(/=(.*)/s) as [string, string]; return { label, file }; }) };
}

function loadRun(label: string, file: string): Run {
  const report = JSON.parse(readFileSync(file, 'utf8')) as Report;
  return { label, file, report, byId: new Map(report.results.map((r) => [r.id, r])) };
}

const num = (value: unknown) => Number(value ?? 0).toLocaleString('id-ID');
const quote = (s: string) => `"${s}"`;
/** Model text as a safe blockquote: no code fences or relative links that would break Markdown checks. */
function answerBlock(answer: string): string[] {
  const clean = answer.replace(/```/g, "'''").replace(/\[/g, '\\[').trim();
  const cut = clean.length > ANSWER_CHARS ? `${clean.slice(0, ANSWER_CHARS)} … (dipotong; lengkap di report JSON)` : clean;
  const lines = cut.split(/\r?\n/).filter((line) => line.trim() !== '');
  const shown = lines.length > ANSWER_LINES ? [...lines.slice(0, ANSWER_LINES), '… (baris berikutnya dipotong)'] : lines;
  return shown.length === 0 ? ['> (tidak ada jawaban teks)'] : shown.map((line) => `> ${line}`);
}

function toolRules(e: Expect): string[] {
  return [
    ...(e.toolsAll?.length ? [`- Tool wajib dipanggil: ${e.toolsAll.join(', ')}`] : []),
    ...(e.toolsAny?.length ? [`- Minimal salah satu tool: ${e.toolsAny.join(' / ')}`] : []),
  ];
}

function answerRules(e: Expect): string[] {
  return [
    ...(e.answerAll ?? []).map((group) => `- Jawaban harus memuat: ${group.map(quote).join(' atau ')}`),
    ...(e.answerNone?.length ? [`- Jawaban tidak boleh memuat: ${e.answerNone.map(quote).join(', ')}`] : []),
  ];
}

function expectation(item: CaseDef): string[] {
  const e = item.expect;
  const approval = e.approval
    ? `- Approval wajib diminta untuk ${e.approval} (keputusan runner: ${item.approvalDecision === 'accept' ? 'TERIMA' : 'TOLAK'})`
    : '- Tidak boleh ada permintaan approval';
  return [`- Status yang diterima: ${e.status.join(' / ')}`, ...toolRules(e), ...answerRules(e), approval,
    ...(item.note ? [`- Catatan dataset: ${item.note}`] : [])];
}

function observed(run: Run, id: string): string[] {
  const r = run.byId.get(id);
  if (r === undefined) return [`**${run.label}**: tidak dijalankan`, ''];
  const u = r.usage ?? {};
  const head = `**${run.label}**: ${r.pass ? '✅ PASS' : '❌ FAIL'} · status \`${r.status}\` · ${u.calls ?? 0} model call · `
    + `token ${num(u.input)} in / ${num(u.output)} out · cache r${num(u.cacheRead)}/w${num(u.cacheWrite)} · ${Number(r.seconds).toFixed(1)} dtk`;
  const lines = [head, '', `- Tool dipanggil: ${r.tools.length ? r.tools.join(' → ') : '(tidak ada)'}`];
  if (r.approvals.length) lines.push(`- Approval diminta: ${r.approvals.join(', ')}`);
  for (const failure of r.failures) lines.push(`- Alasan gagal: ${failure}`);
  return [...lines, '', ...answerBlock(String(r.answer ?? '')), ''];
}

function caseBlock(item: CaseDef, runs: Run[]): string[] {
  const verdicts = runs.map((run) => { const r = run.byId.get(item.id); return `${run.label} ${r === undefined ? '—' : r.pass ? '✅' : '❌'}`; });
  const turns = item.turns ?? [String(item.question)];
  const asked = turns.length === 1 ? [`**Pertanyaan:** ${turns[0]}`] : turns.map((t, i) => `**Pertanyaan ${i + 1}:** ${t}`);
  return [`## ${item.id} · ${item.family} · ${verdicts.join(' · ')}`, '', ...asked.flatMap((line) => [line, '']),
    '**Yang diharapkan**', '', ...expectation(item), '', ...runs.flatMap((run) => observed(run, String(item.id))),
    '- [ ] Reviewer: jawaban benar dan pantas untuk pengguna', '- Catatan reviewer: ', ''];
}

function pack(blocks: string[][]): string[][] {
  const files: string[][] = [];
  for (const block of blocks) {
    const current = files.at(-1);
    if (current === undefined || current.length + block.length > MAX_LINES) files.push([...block]); else current.push(...block);
  }
  return files;
}

function totalsRow(run: Run): string {
  const t = run.report.totals; const m = run.report.model ?? {};
  return `| ${run.label} | ${m.model ?? '?'} / ${m.effort ?? '?'} / cache ${m.promptCache ?? 'off'} | ${t.pass}/${t.runs ?? t.cases} | ${num(t.calls)} | `
    + `${num(t.input)} | ${num(t.cacheRead)} / ${num(t.cacheWrite)} | ${num(t.effectiveInput ?? t.input)} | ${num(t.output)} | ${Number(t.seconds).toFixed(0)} |`;
}

function outcome(run: Run, id: string): string {
  const r = run.byId.get(id);
  return r === undefined ? 'tidak dijalankan' : r.pass ? 'lulus' : 'gagal';
}

/** Only runs that executed a case are compared; a partial rerun is not a "difference" for the rest. */
function differences(cases: CaseDef[], runs: Run[]): string[] {
  const ran = (c: CaseDef) => runs.filter((run) => run.byId.has(c.id));
  const rows = cases.filter((c) => new Set(ran(c).map((run) => outcome(run, c.id))).size > 1)
    .map((c) => `- ${c.id} (${c.family}): ${ran(c).map((run) => `${run.label} ${outcome(run, c.id)}`).join(', ')}`);
  return rows.length ? rows : ['- Tidak ada: setiap case berhasil/gagal sama di semua run.'];
}

function failures(cases: CaseDef[], runs: Run[]): string[] {
  const rows = runs.flatMap((run) => cases.flatMap((c) => {
    const r = run.byId.get(c.id);
    return r && !r.pass ? [`- ${run.label} · ${c.id}: ${r.failures.join('; ')}`] : [];
  }));
  return rows.length ? rows : ['- Tidak ada.'];
}

const short = (value: string | undefined, length: number) => (value ?? '?').slice(0, length);
/** Dirty paths are listed: a modified tracked log file is not the same as untested code. */
function serviceLabel([name, v]: [string, Service]): string {
  const dirty = v.dirty ?? [];
  const note = dirty.length === 0 ? '' : ` (belum di-commit: ${dirty.slice(0, 2).join(', ')}${dirty.length > 2 ? ', …' : ''})`;
  return `${name} ${short(v.commit, 7)}${note}`;
}

function catalogLabel(m: Manifest): string {
  const cat = m.gateway?.catalog ?? {};
  return `katalog ${cat.count ?? '?'} tool / ${num(cat.tokens?.catalogTokens)} token`;
}

function identity(run: Run): string[] {
  const m = run.report.manifest ?? {}; const file = path.basename(run.file);
  const svc = Object.entries(m.services ?? {}).map(serviceLabel).join(', ') || '?';
  return [`- **${run.label}**: [${file}](${file}), engine src \`${short(m.engine?.src?.sha256, 12)}\`, `
    + `dataset \`${short(m.dataset?.sha256, 12)}\`, ${catalogLabel(m)}, service: ${svc}`];
}

function readme(title: string, cases: CaseDef[], runs: Run[], files: string[][]): string[] {
  const index = files.map((file, i) => {
    const ids = file.filter((line) => line.startsWith('## ')).map((line) => line.slice(3).split(' · ')[0]);
    return `- [cases-${String(i + 1).padStart(2, '0')}.md](cases-${String(i + 1).padStart(2, '0')}.md): ${ids[0]} – ${ids.at(-1)}`;
  });
  return [`# ${title}`, '', `Dibuat ${new Date().toISOString().slice(0, 10)} oleh \`docs/integration/workin-live-qa.mts\` dari report live Viper`,
    '(model sungguhan → gateway MCP Workin → attendance + employees, data dev dummy). Jangan edit manual; buat ulang dari report.', '',
    '## Ringkasan', '', '| Run | Model / effort / cache | Lulus | Model call | Token input | Cache read / write | Effective input | Token output | Detik |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |', ...runs.map(totalsRow), '',
    'Effective input = input tanpa cache + 1,25 × cache write + 0,05 × cache read (harga relatif Opus 5.5, TTL 5 menit).', '',
    '## Perbedaan hasil antar run', '', ...differences(cases, runs), '', '## Case yang gagal', '', ...failures(cases, runs), '',
    '## Identitas run', '', ...runs.flatMap(identity), '', '## Detail per case', '', ...index, '',
    '## Cara review', '', '1. Buka file detail; tiap case berisi pertanyaan, kriteria otomatis, tool yang dipakai, dan jawaban Viper.',
    '2. Verdict ✅/❌ berasal dari aturan otomatis di `evals/datasets/workin-live/cases.json` (cek kata kunci, tool, status, approval).',
    '   Itu belum tentu sama dengan penilaian manusia: beri centang pada "Reviewer" dan tulis catatan bila jawaban salah, kurang, atau tidak pantas.',
    '3. Bandingkan dengan run lain memakai `docs/integration/workin-live-compare.mts <base.json> <candidate.json>`.', ''];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const runs = args.runs.map(({ label, file }) => loadRun(label, file));
  const dataset = JSON.parse(readFileSync('evals/datasets/workin-live/cases.json', 'utf8')) as { cases: CaseDef[] };
  const ids = new Set(runs.flatMap((run) => [...run.byId.keys()]));
  const cases = dataset.cases.filter((c) => ids.has(c.id));
  mkdirSync(args.out, { recursive: true });
  const files = pack(cases.map((c) => caseBlock(c, runs)));
  files.forEach((lines, i) => writeFileSync(path.join(args.out, `cases-${String(i + 1).padStart(2, '0')}.md`),
    [`# ${args.title}: detail ${i + 1}/${files.length}`, '', 'Kembali ke [ringkasan](README.md).', '', ...lines].join('\n')));
  for (const run of runs) {
    const trimmed = { ...run.report, results: run.report.results.map(({ events: _events, ...rest }) => rest) };
    writeFileSync(path.join(args.out, `report-${run.label}.json`), `${JSON.stringify(trimmed, null, 2)}\n`);
  }
  const copies = runs.map((run) => ({ ...run, file: path.join(args.out, `report-${run.label}.json`) }));
  writeFileSync(path.join(args.out, 'README.md'), readme(args.title, cases, copies, files).join('\n'));
  console.log(`QA report: ${path.join(args.out, 'README.md')} (${files.length} detail file(s), ${cases.length} cases)`);
}

main();
