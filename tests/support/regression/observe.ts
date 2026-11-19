import { performance } from 'node:perf_hooks';
import type { RegressionFixture } from './fixture.js';
import type { EngineCase } from './cases.js';
import { checkpoint } from '../../integration/postgres/engine-fixtures.js';
import { parseId } from '../../../src/contracts/identity/ids.js';

export async function observeTrial(f: RegressionFixture, scenario: EngineCase, mode: 'cold' | 'warm', repeat: number) {
  f.effects.reset(); const requestStart = f.script.requests().length; const pagesStart = f.catalogPages();
  const started = performance.now();
  const conversation = await f.client.createConversation({ title: scenario.id });
  const body = { input: { content: [{ type: 'text' as const, text: `Execute synthetic ${scenario.id}` }] } };
  const key = `${scenario.id}-${mode}`; const run = await f.client.startRun(conversation.conversationId, body, key);
  if (scenario.control === 'cancel') await f.client.cancel(run.runId);
  const first = await f.engine.runOnce('regression');
  await control(f, scenario, run.runId);
  const final = await f.client.run(run.runId); const localMs = performance.now() - started;
  const stored = await checkpoint(f.db.pool, parseId('run', run.runId));
  const requests = f.script.requests().slice(requestStart); const writes = f.effects.writes();
  const tools = [...f.effects.calls];
  const foreignStatuses = [];
  for (const token of ['other', 'tenant']) {
    const response = await f.app.inject({ method: 'GET', url: `/api/v1/runs/${run.runId}`, headers: { authorization: `Bearer ${token}` } });
    foreignStatuses.push(response.statusCode);
  }
  const duplicate = await f.client.startRun(conversation.conversationId, body, key);
  const idle = await f.engine.runOnce('regression-observe-only');
  const modelAudit = await f.db.pool.query(`SELECT id, step_id, attempt, provider, model, outcome, usage_source, input_tokens, output_tokens, total_tokens
    FROM viper_engine.model_calls WHERE run_id = $1 ORDER BY started_at, id`, [run.runId]);
  return { schemaVersion: 1, caseId: scenario.id, family: scenario.family, mode, repeat, runId: run.runId, localMs,
    status: final.status, usage: final.usage, modelCalls: requests.length, tools, writes,
    catalogPages: f.catalogPages() - pagesStart, first, requests, snapshot: final, history: stored.history,
    toolCalls: stored.toolCalls, approvals: stored.approvals, modelAudit: modelAudit.rows,
    checks: { foreignStatuses, sameIdempotentRun: duplicate.runId === run.runId, idle: idle.kind === 'idle',
      noExtraEffects: f.effects.writes() === writes && f.script.requests().length === requestStart + requests.length } };
}
async function control(f: RegressionFixture, scenario: EngineCase, runId: string) {
  if (scenario.control === 'input') {
    const waiting = await f.client.run(runId);
    await f.client.submitInput(runId, { expectedRevision: waiting.revision, inputId: 'regression-answer',
      input: { content: [{ type: 'text', text: 'a' }] } });
    await f.engine.runOnce('regression-input');
  }
  if (scenario.control === 'accept' || scenario.control === 'reject') {
    const waiting = await f.client.run(runId); const approval = waiting.pendingApprovals?.[0];
    if (approval === undefined) throw new Error('Regression fixture expected an approval pause');
    if (f.effects.writes() !== 0 || JSON.stringify(approval.arguments) !== '{"count":5}') throw new Error('Write must wait for exact approval');
    await f.client.decideApproval(approval.approvalId, { expectedRevision: approval.revision, proposal: approval.proposal, decision: scenario.control });
    await f.engine.runOnce('regression-approved-or-declined');
  }
}
export type TrialObservation = Awaited<ReturnType<typeof observeTrial>>;
