import { parseId } from '../../../contracts/identity/ids.js';
import type { ModelCallId, RunId, StepId, ToolCallId } from '../../../contracts/identity/ids.js';
import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type {
  AttemptResultKind, ExecutionLedger, ModelCallFinish, ModelCallStart, StepDecisionKind, StepStart, ToolCallAttempt,
} from '../../../contracts/state/execution-records.js';
import type { LeaseToken } from '../../../contracts/state/leases.js';
import { stateConflict, stateOk } from '../../../contracts/state/result.js';
import type { StateConflict, StateResult } from '../../../contracts/state/result.js';
import { admissionConflict, appendEvents, leaseConflict, lockRun, NOT_FOUND } from './run-lock.js';
import type { NewRunEvent } from '../../../contracts/state/events.js';
import { validateModelFinish } from './execution-validation.js';
import { asRow, integer, member, msColumn, MS_PARAM, ownerColumns } from './rows.js';
import type { SqlPool, SqlQueryable } from './sql-client.js';
import { withTransaction } from './sql-client.js';

const RESULTS: readonly AttemptResultKind[] = ['succeeded', 'failed', 'unknown', 'retry_wait'];
const ALREADY = (what: string): StateConflict => ({ code: 'invalid_transition', message: `${what} is already finished` });

function attempt(value: unknown): ToolCallAttempt {
  const row = asRow(value);
  const settled = row['settled_at_ms'] === null ? {} : {
    settledAt: integer(row, 'settled_at_ms'), resultKind: member(row, 'result_kind', RESULTS),
  };
  return Object.freeze({
    runId: parseId('run', row['run_id']), toolCallId: parseId('tool_call', row['tool_call_id']), attempt: integer(row, 'attempt'),
    dispatchedAt: integer(row, 'dispatched_at_ms'), ...settled,
    ...(typeof row['worker_id'] === 'string' ? { workerId: row['worker_id'], fence: integer(row, 'lease_fence') } : {}),
  });
}

/** Step and model-call audit rows, written under the run lock (and lease when given). */
export class PostgresExecutionLedger implements ExecutionLedger {
  constructor(private readonly pool: SqlPool) {}

  /** Steps are 1-based and gap-free; a step index that does not follow the last is a conflict. */
  async startStep(scope: TrustedScope, input: StepStart): Promise<StateResult<{ readonly stepId: StepId }>> {
    return this.write(scope, input.runId, input.at, input.lease, async tx => {
      const last = await tx.query('SELECT coalesce(max(step_index), 0)::int AS last FROM viper_engine.run_steps WHERE run_id = $1', [input.runId]);
      const previous = integer(asRow(last.rows[0]), 'last');
      if (input.stepIndex !== previous + 1) return { code: 'sequence_conflict', message: `Step ${input.stepIndex} does not follow ${previous}` };
      await tx.query(`INSERT INTO viper_engine.run_steps (run_id, step_index, id, actor_id, app_id, tenant_key, started_at)
        VALUES ($1, $2, $3, $4, $5, $6, ${MS_PARAM(7)})`, [input.runId, input.stepIndex, input.stepId, ...ownerColumns(scope), input.at]);
      return undefined;
    }, { stepId: input.stepId }, true, input.events);
  }

  async finishStep(scope: TrustedScope, input: { readonly runId: RunId; readonly stepId: StepId; readonly decision: StepDecisionKind; readonly at: number; readonly lease?: LeaseToken }) {
    return this.write(scope, input.runId, input.at, input.lease, async tx => {
      const done = await tx.query(`UPDATE viper_engine.run_steps SET decision_kind = $3, ended_at = ${MS_PARAM(4)}
        WHERE run_id = $1 AND id = $2 AND ended_at IS NULL`, [input.runId, input.stepId, input.decision, input.at]);
      return done.rowCount === 1 ? undefined : ALREADY('Step');
    }, { stepId: input.stepId });
  }

  async startModelCall(scope: TrustedScope, input: ModelCallStart): Promise<StateResult<{ readonly modelCallId: ModelCallId }>> {
    return this.write(scope, input.runId, input.at, input.lease, async tx => {
      await tx.query(`INSERT INTO viper_engine.model_calls (id, run_id, step_id, actor_id, app_id, tenant_key, attempt, provider, model,
          usage_source, outcome, started_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'unavailable', 'pending', ${MS_PARAM(10)})`, [
        input.modelCallId, input.runId, input.stepId, ...ownerColumns(scope), input.attempt, input.provider, input.model, input.at,
      ]);
      return undefined;
    }, { modelCallId: input.modelCallId }, true);
  }

  /** Records outcome and usage once; no prompt, output or provider error text is stored. */
  async finishModelCall(scope: TrustedScope, input: ModelCallFinish): Promise<StateResult<{ readonly modelCallId: ModelCallId }>> {
    return this.write(scope, input.runId, input.at, input.lease, async tx => {
      validateModelFinish(input);
      const { usage } = input;
      const done = await tx.query(`UPDATE viper_engine.model_calls SET outcome = $3, failure_code = $4, usage_source = $5,
          input_tokens = $6, output_tokens = $7, total_tokens = $8, ended_at = ${MS_PARAM(9)}
        WHERE run_id = $1 AND id = $2 AND outcome = 'pending'`, [input.runId, input.modelCallId, input.outcome,
        input.failureCode ?? null, usage.source, usage.inputTokens, usage.outputTokens, usage.totalTokens, input.at]);
      return done.rowCount === 1 ? undefined : ALREADY('Model call');
    }, { modelCallId: input.modelCallId });
  }

  async listToolCallAttempts(scope: TrustedScope, runId: RunId, toolCallId: ToolCallId): Promise<StateResult<readonly ToolCallAttempt[]>> {
    return withTransaction(this.pool, async tx => {
      const run = await lockRun(tx, scope, runId, 'SHARE');
      if (!run.ok) return stateConflict(run.error);
      const rows = await tx.query(`SELECT run_id, tool_call_id, attempt, worker_id, lease_fence, result_kind,
          ${msColumn('dispatched_at')}, ${msColumn('settled_at')}
        FROM viper_engine.tool_call_attempts WHERE run_id = $1 AND tool_call_id = $2 ORDER BY attempt`, [runId, toolCallId]);
      return stateOk(Object.freeze(rows.rows.map(attempt)));
    });
  }

  private async write<Value>(
    scope: TrustedScope, runId: RunId, at: number, lease: LeaseToken | undefined,
    work: (tx: SqlQueryable) => Promise<StateConflict | undefined>, value: Value, admitNewWork = false, events: readonly NewRunEvent[] = [],
  ): Promise<StateResult<Value>> {
    return withTransaction(this.pool, async tx => {
      const run = await lockRun(tx, scope, runId);
      if (!run.ok) return stateConflict(run.error.code === 'not_found' ? NOT_FOUND : run.error);
      const failure = leaseConflict(run.value, lease, at)
        ?? (admitNewWork ? admissionConflict(run.value.record) : undefined) ?? await work(tx);
      if (failure !== undefined) return stateConflict(failure);
      await appendEvents(tx, scope, run.value, events);
      return stateOk(Object.freeze(value));
    });
  }
}
