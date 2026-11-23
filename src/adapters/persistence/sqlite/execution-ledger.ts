import type { ModelCallId, RunId, StepId, ToolCallId } from '../../../contracts/identity/ids.js';
import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type { ExecutionLedger, ModelCallFinish, ModelCallStart, StepStart, ToolCallAttempt } from '../../../contracts/state/execution-records.js';
import type { LeaseToken } from '../../../contracts/state/leases.js';
import type { NewRunEvent } from '../../../contracts/state/events.js';
import { stateConflict, stateOk } from '../../../contracts/state/result.js';
import type { StateConflict, StateResult } from '../../../contracts/state/result.js';
import { attempt } from '../postgres/execution-ledger.js';
import { validateModelFinish } from '../postgres/execution-validation.js';
import { admissionConflict, leaseConflict } from '../postgres/run-lock.js';
import { asRow, integer, ownerColumns } from '../postgres/rows.js';
import { withTransaction } from '../postgres/sql-client.js';
import type { SqlPool, SqlQueryable } from '../postgres/sql-client.js';
import { appendEvents, lockRun } from './run-store.js';

const already = (what: string): StateConflict => ({ code: 'invalid_transition', message: `${what} is already finished` });

export class SqliteExecutionLedger implements ExecutionLedger {
  constructor(private readonly pool: SqlPool, private readonly clock: () => number = Date.now) {}

  async startStep(scope: TrustedScope, input: StepStart): Promise<StateResult<{ readonly stepId: StepId }>> {
    return this.write(scope, input.runId, input.at, input.lease, async tx => {
      const result = await tx.query('SELECT coalesce(max(step_index), 0) AS last FROM viper_engine.run_steps WHERE run_id = ?', [input.runId]);
      const last = integer(asRow(result.rows[0]), 'last');
      if (input.stepIndex !== last + 1) return { code: 'sequence_conflict', message: `Step ${input.stepIndex} does not follow ${last}` };
      await tx.query(`INSERT INTO viper_engine.run_steps (run_id, step_index, id, actor_id, app_id, tenant_key, started_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, [input.runId, input.stepIndex, input.stepId, ...ownerColumns(scope), input.at]);
      return undefined;
    }, { stepId: input.stepId }, true, input.events);
  }

  async finishStep(scope: TrustedScope, input: Parameters<ExecutionLedger['finishStep']>[1]): ReturnType<ExecutionLedger['finishStep']> {
    return this.write(scope, input.runId, input.at, input.lease, async tx => {
      const done = await tx.query(`UPDATE viper_engine.run_steps SET decision_kind = ?, ended_at_ms = ?
        WHERE run_id = ? AND id = ? AND ended_at_ms IS NULL`, [input.decision, input.at, input.runId, input.stepId]);
      return done.rowCount === 1 ? undefined : already('Step');
    }, { stepId: input.stepId });
  }

  async startModelCall(scope: TrustedScope, input: ModelCallStart): Promise<StateResult<{ readonly modelCallId: ModelCallId }>> {
    return this.write(scope, input.runId, input.at, input.lease, async tx => {
      await tx.query(`INSERT INTO viper_engine.model_calls (id, run_id, step_id, actor_id, app_id, tenant_key, attempt, provider, model,
        usage_source, outcome, started_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unavailable', 'pending', ?)`,
      [input.modelCallId, input.runId, input.stepId, ...ownerColumns(scope), input.attempt, input.provider, input.model, input.at]);
      return undefined;
    }, { modelCallId: input.modelCallId }, true);
  }

  async finishModelCall(scope: TrustedScope, input: ModelCallFinish): Promise<StateResult<{ readonly modelCallId: ModelCallId }>> {
    return this.write(scope, input.runId, input.at, input.lease, async tx => {
      validateModelFinish(input);
      const { usage } = input;
      const done = await tx.query(`UPDATE viper_engine.model_calls SET outcome = ?, failure_code = ?, usage_source = ?,
        input_tokens = ?, output_tokens = ?, total_tokens = ?, ended_at_ms = ?, cache_read_tokens = ?, cache_write_tokens = ?,
        failure_detail = ? WHERE run_id = ? AND id = ? AND outcome = 'pending'`,
      [input.outcome, input.failureCode ?? null, usage.source, usage.inputTokens, usage.outputTokens, usage.totalTokens,
        input.at, usage.cacheReadTokens ?? null, usage.cacheWriteTokens ?? null, input.failureDetail ?? null, input.runId, input.modelCallId]);
      return done.rowCount === 1 ? undefined : already('Model call');
    }, { modelCallId: input.modelCallId });
  }

  async listToolCallAttempts(scope: TrustedScope, runId: RunId, id: ToolCallId): Promise<StateResult<readonly ToolCallAttempt[]>> {
    return withTransaction(this.pool, async tx => {
      const run = await lockRun(tx, scope, runId, this.clock);
      if (!run.ok) return stateConflict(run.error);
      const rows = await tx.query('SELECT * FROM viper_engine.tool_call_attempts WHERE run_id = ? AND tool_call_id = ? ORDER BY attempt', [runId, id]);
      return stateOk(Object.freeze(rows.rows.map(attempt)));
    });
  }

  private async write<T>(scope: TrustedScope, runId: RunId, at: number, lease: LeaseToken | undefined,
    work: (tx: SqlQueryable) => Promise<StateConflict | undefined>, value: T, admit = false, events: readonly NewRunEvent[] = []): Promise<StateResult<T>> {
    return withTransaction(this.pool, async tx => {
      const run = await lockRun(tx, scope, runId, this.clock);
      if (!run.ok) return stateConflict(run.error);
      const failure = leaseConflict(run.value, lease, at) ?? (admit ? admissionConflict(run.value.record) : undefined) ?? await work(tx);
      if (failure !== undefined) return stateConflict(failure);
      await appendEvents(tx, run.value.record, scope, run.value.lastEventSequence, events);
      return stateOk(Object.freeze(value));
    });
  }
}
