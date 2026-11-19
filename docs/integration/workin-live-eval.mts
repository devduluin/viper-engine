// Live evaluation runner for evals/datasets/workin-live/cases.json.
// Real Viper engine (HTTP API + worker + engine, same composition as examples/fixture-demo.ts) with the
// configured model (VIPER_MODEL*) and the MCP Workin gateway. Isolated viper_it_* database, dropped after.
// Approvals are REJECTED unless a case sets "approvalDecision": "accept" (that case writes to the dev
// Workin DB; docs/integration/workin-dummy-seed.cjs --cleanup removes it). A case may have several user
// "turns" in one conversation. TRIALS=n repeats every case n times (default 1). The report pins a manifest
// (engine/dataset/runner hashes, model, tool catalog, service commits): workin-live-manifest.mts.
// VARIANTS=baseline,checklist runs every case with and without the generic P07-04 checklist
// (workin-live-plan.mts), alternating order per trial; one report per variant.
// Report: artifacts/evals/workin-live-<time>/report.json; compare two with workin-live-compare.mts.
//
//   cd D:/Development/App/viper-engine
//   VIPER_TEST_DB_HOST=127.0.0.1 WORKIN_TOKEN_FILE=<sso token file> [CASES=WL-001,WL-005] [TRIALS=3] \
//     node --env-file=.env --import tsx docs/integration/workin-live-eval.mts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Expect } from './workin-live-grade.mts';

const ROOT = path.resolve('.');
const load = (file: string) => import(new URL(`file:///${path.join(ROOT, file).replace(/\\/g, '/')}`).href);
const { createDatabase } = await load('tests/integration/postgres/database.ts');
const { http } = await load('tests/integration/postgres/http-fixtures.ts');
const { worker } = await load('tests/integration/postgres/worker-fixtures.ts');
const { seedEngineConnection } = await load('tests/integration/postgres/engine-fixtures.ts');
const { createEngineClient } = await load('src/bootstrap/client.ts');
const { parseConfiguredModelConfig, createConfiguredModelBinding } = await load('src/bootstrap/configured-model.ts');
const { parseToolDiscoveryConfig } = await load('src/bootstrap/tool-discovery-config.ts');
const { parseMessage } = await load('src/contracts/messages/parse-message.ts');
const { buildManifest } = await load('docs/integration/workin-live-manifest.mts');
const { grade } = await load('docs/integration/workin-live-grade.mts');
const { createPlanEvidence } = await load('src/bootstrap/planning.ts');
const { CHECKLIST_SHA256, WORKIN_CHECKLIST, parseVariants, switchableChecklist, variantOrder } = await load('docs/integration/workin-live-plan.mts');

type Row = Record<string, unknown>;
interface Case { id: string; family: string; question?: string; turns?: string[]; approvalDecision?: 'accept' | 'reject'; expect: Expect }
const turnsOf = (item: Case) => item.turns ?? [String(item.question)];

const dataset = JSON.parse(readFileSync('evals/datasets/workin-live/cases.json', 'utf8')) as { cases: Case[] };
const only = (process.env.CASES ?? '').split(',').filter(Boolean);
const cases = dataset.cases.filter((c) => only.length === 0 || only.includes(c.id));
const trials = Number(process.env.TRIALS ?? 1);
if (!Number.isSafeInteger(trials) || trials < 1 || trials > 10) throw new RangeError('TRIALS must be an integer 1..10');
const variants = parseVariants(process.env.VARIANTS) as ('baseline' | 'checklist')[];
let checklistActive = false;
const token = readFileSync(String(process.env.WORKIN_TOKEN_FILE), 'utf8').trim();
const gatewayUrl = process.env.WORKIN_GATEWAY_URL ?? 'http://127.0.0.1:9996/api/v2/mcp';
const clock = { now: () => Date.now() };
const modelConfig = parseConfiguredModelConfig(process.env);
const toolDiscovery = parseToolDiscoveryConfig(process.env);
// Trusted host instruction (engine option `instructions`): role, today's date, timezone, language.
// Deliberately neutral: it must not contain dataset answers or tool hints beyond the role.
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
const HOST_INSTRUCTION = `Kamu adalah asisten HR untuk aplikasi Workin. Hari ini ${today} (zona waktu Asia/Jakarta). `
  + 'Gunakan tool Workin untuk data karyawan dan kehadiran; jangan menebak data yang tidak ada di hasil tool. '
  + 'Jawab dalam Bahasa Indonesia secara ringkas.';
const instructions = [parseMessage({ id: 'host-workin', role: 'system', content: [{ type: 'text', text: HOST_INSTRUCTION }] })];

const text = (content: unknown) => (Array.isArray(content) ? content : [])
  .map((block: Row) => (block.type === 'text' ? String(block.text) : '')).join(' ').trim();
const remoteName = (alias: string) => alias.replace(/^[a-z0-9]+__/, '');


const db = await createDatabase();
const app = http(db.pool, { stream: { pollMs: 50, heartbeatMs: 1000, maxStreamMs: 300000 } });
const connectionId = await seedEngineConnection(db.pool, gatewayUrl, 'workin');
const host = worker(db.pool, createConfiguredModelBinding(modelConfig, clock), {
  credentials: { resolve: async () => ({ ok: true, credential: { kind: 'bearer', token } }),
    refresh: async () => ({ ok: false, code: 'authentication_required' }) },
  connections: async () => [{ id: connectionId, namespace: 'workin' }],
  policy: { decide: (tool: { definition: { annotations?: { readOnlyHint?: boolean }; ref: { name: string } } }) =>
    (tool.definition.annotations?.readOnlyHint === false ? 'requires_approval' : 'execute') },
  requestTimeoutMs: 60000, discoveryTimeoutMs: 30000, leaseMs: 60000, heartbeatMs: 5000, limits: { maxDurationMs: 240000 },
  instructions, toolDiscovery,
  ...(variants.includes('checklist') ? { contextEvidence: switchableChecklist(createPlanEvidence, () => checklistActive) } : {}),
});
const baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
const client = createEngineClient({ baseUrl, getToken: async () => 'owner', requestTimeoutMs: 60000 });
host.start();

interface TurnResult { runId: string; status: string }
type Decide = (approval: { proposal: { tool: { name: string } } }) => Promise<'accept' | 'reject'>;

/** Pending approvals/input of a waiting snapshot; returns false when the run must stay paused. */
async function respond(snapshot: Row, decide: Decide): Promise<boolean> {
  if (snapshot.status === 'waiting_for_approval') {
    for (const approval of (snapshot.pendingApprovals ?? []) as Row[]) {
      const decision = await decide(approval as never);
      await client.decideApproval(String(approval.approvalId), { expectedRevision: approval.revision, proposal: approval.proposal, decision });
    }
    return true;
  }
  return snapshot.status !== 'waiting_for_input'; // the dataset gives no mid-run answers
}

/** One user turn in an existing conversation, watched until it settles (same flow as examples/headless.ts). */
async function runTurn(conversationId: string, question: string, key: string, decide: Decide, events: string[]): Promise<TurnResult> {
  const run = await client.startRun(conversationId, { input: { content: [{ type: 'text', text: question }] } }, key);
  let latest: Row | undefined;
  for await (const update of client.watch(run.runId)) {
    events.push(update.kind === 'event' ? String(update.event.type) : `snapshot:${update.snapshot.status}`);
    if (update.kind === 'snapshot') latest = update.snapshot;
    else if (['approval.required', 'run.input_required'].includes(update.event.type)) latest = await client.run(run.runId);
    else continue;
    if (!await respond(latest as Row, decide)) break;
  }
  const final = await client.run(run.runId);
  return { runId: run.runId, status: String(final.status ?? latest?.status) };
}

async function failureEvents(runId: string): Promise<string[]> {
  const rows = (await db.pool.query('SELECT type, payload FROM viper_engine.run_events WHERE run_id = $1 ORDER BY sequence', [runId])).rows as Row[];
  return rows.map((row) => `${String(row.type)}${JSON.stringify(row.payload) === '{}' ? '' : JSON.stringify(row.payload)}`);
}

async function runCase(item: Case, started: number, approvals: string[], events: string[]) {
  const decision = item.approvalDecision ?? 'reject';
  const decide: Decide = async (approval) => { approvals.push(remoteName(approval.proposal.tool.name)); return decision; };
  await client.capabilities();
  const conversation = await client.createConversation({});
  const turns: TurnResult[] = [];
  for (const [index, question] of turnsOf(item).entries()) {
    turns.push(await runTurn(conversation.conversationId, question, `${item.id}-${started}-${index}`, decide, events));
  }
  const status = turns.at(-1)?.status ?? 'error';
  const messages = (await db.pool.query('SELECT role, content, tool_calls FROM viper_engine.messages WHERE conversation_id = $1 ORDER BY position', [conversation.conversationId])).rows as Row[];
  const tools = messages.flatMap((m) => (Array.isArray(m.tool_calls) ? (m.tool_calls as Row[]).map((c) => remoteName(String(c.name))) : []));
  const answer = text([...messages].reverse().find((m) => m.role === 'assistant' && text(m.content))?.content);
  if (!['completed', 'partial', 'waiting_for_approval', 'waiting_for_input'].includes(status)) events.push(...await failureEvents(turns.at(-1)!.runId));
  // input = whole prompt; cacheRead/cacheWrite are parts of it (X01). NULL cache columns count as 0.
  const usage = (await db.pool.query(`SELECT count(*)::int AS calls, coalesce(sum(input_tokens),0)::int AS input, coalesce(sum(output_tokens),0)::int AS output,
    coalesce(sum(cache_read_tokens),0)::int AS "cacheRead", coalesce(sum(cache_write_tokens),0)::int AS "cacheWrite"
    FROM viper_engine.model_calls WHERE run_id = ANY($1)`, [turns.map((turn) => turn.runId)])).rows[0] as Row;
  return { status, tools, answer, usage };
}

const modelInfo = { provider: modelConfig.provider ?? process.env.VIPER_MODEL_PROVIDER, model: process.env.VIPER_MODEL, effort: process.env.VIPER_MODEL_EFFORT,
  promptCache: modelConfig.promptCache ?? null };
const manifest = await buildManifest({ root: ROOT, gatewayUrl, token, hostInstruction: HOST_INSTRUCTION, model: modelInfo, toolDiscovery, trials, caseIds: cases.map((c) => c.id) });
const results: Row[] = [];
try {
  for (let trial = 1; trial <= trials; trial += 1) for (const item of cases) for (const variant of variantOrder(variants, trial)) {
    checklistActive = variant === 'checklist';
    const started = Date.now();
    const approvals: string[] = [];
    const events: string[] = [];
    let observed = { status: 'error', tools: [] as string[], answer: '', usage: {} as Row }; let error: string | undefined;
    try { observed = await runCase(item, started, approvals, events); } catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
    const failures = error ? [`run error: ${error}`] : grade(item.expect, { ...observed, approvals });
    const usage = observed.usage;
    const result = { id: item.id, trial, variant, family: item.family, turns: turnsOf(item), pass: failures.length === 0, failures, ...observed, approvals, events, seconds: (Date.now() - started) / 1000 };
    results.push(result);
    const tag = `${trials > 1 ? ` #${trial}` : ''}${variants.length > 1 ? ` [${variant}]` : ''}`;
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${item.id}${tag} (${result.seconds}s, ${usage.calls ?? 0} calls, ${usage.input ?? 0}/${usage.output ?? 0} tok, cache r${usage.cacheRead ?? 0}/w${usage.cacheWrite ?? 0}) ${turnsOf(item).join(' / ')}`);
    for (const failure of failures) console.log(`     - ${failure}`);
    if (!result.pass) console.log(`     events: ${events.join(' > ')}`);
  }
} finally {
  await host.stop(); await app.close(); await db.drop();
}

const reportId = `workin-live-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const dir = path.join('artifacts', 'evals', reportId);
mkdirSync(dir, { recursive: true });

// Opus 5.5 / Sonnet 5.5 prompt-cache price factors relative to base input (5-minute TTL); recorded in the report.
const CACHE_FACTORS = { read: 0.05, write5m: 1.25 };

function totalsOf(rows: Row[]) {
  const sum = (key: string) => rows.reduce((acc, r) => acc + Number((r.usage as Row)[key] ?? 0), 0);
  const [input, cacheRead, cacheWrite] = [sum('input'), sum('cacheRead'), sum('cacheWrite')];
  // Base-input-equivalent tokens: what the prompt costs once cache reads/writes are priced (X01).
  const effectiveInput = Math.round(input - cacheRead - cacheWrite + CACHE_FACTORS.write5m * cacheWrite + CACHE_FACTORS.read * cacheRead);
  return { pass: rows.filter((r) => r.pass).length, calls: sum('calls'), input, output: sum('output'), cacheRead, cacheWrite, effectiveInput,
    seconds: rows.reduce((acc, r) => acc + Number(r.seconds), 0) };
}

// Per case over all trials; `allTrials` is pass^k (every trial passed), the stricter reliability number.
function byCaseOf(rows: Row[]) {
  return cases.map((item) => {
    const runs = rows.filter((r) => r.id === item.id);
    const passes = runs.filter((r) => r.pass).length;
    return { id: item.id, family: item.family, trials: runs.length, passes, passRate: runs.length ? passes / runs.length : 0, allTrials: passes === runs.length };
  });
}

for (const variant of variants) {
  const rows = results.filter((r) => r.variant === variant);
  const totals = totalsOf(rows); const byCase = byCaseOf(rows);
  const plan = variant === 'checklist' ? { variant, checklist: WORKIN_CHECKLIST, checklistSha256: CHECKLIST_SHA256 } : { variant };
  const file = path.join(dir, variants.length > 1 ? `report-${variant}.json` : 'report.json');
  writeFileSync(file, JSON.stringify({
    reportId: variants.length > 1 ? `${reportId}-${variant}` : reportId, kind: 'workin-live (pinned manifest; reference evidence, not the P08-01 regression gate)',
    manifest: { ...manifest, plan, pairedWith: variants.length > 1 ? variants : undefined },
    hostInstruction: HOST_INSTRUCTION, model: modelInfo, gatewayUrl, cacheFactors: CACHE_FACTORS,
    totals: { cases: cases.length, trials, runs: rows.length, ...totals, casesAllTrials: byCase.filter((c) => c.allTrials).length }, byCase, results: rows,
  }, null, 2));
  console.log(`\n[${variant}] ${totals.pass}/${rows.length} runs passed${trials > 1 ? ` (all trials: ${byCase.filter((c) => c.allTrials).length}/${cases.length} cases)` : ''}`
    + ` | model calls ${totals.calls} | tokens in ${totals.input} / out ${totals.output}`
    + ` | cache read ${totals.cacheRead} / write ${totals.cacheWrite} | effective input ${totals.effectiveInput} | ${Number(totals.seconds).toFixed(1)}s`);
  console.log(`report: ${file}`);
}
