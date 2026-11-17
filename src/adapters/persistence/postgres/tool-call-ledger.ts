import type { RunId, StepId, ToolCallId } from '../../../contracts/identity/ids.js';
import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type { McpToolRef } from '../../../contracts/mcp/identity.js';
import type { ArgumentsDigest } from '../../../contracts/state/approval-state.js';
import type { NewRunEvent } from '../../../contracts/state/events.js';
import type { LeaseToken } from '../../../contracts/state/leases.js';
import type { ToolCallLedger } from '../../../contracts/state/ports.js';
import type { ToolCallRecord } from '../../../contracts/state/records.js';
import { stateConflict, stateOk } from '../../../contracts/state/result.js';
import type { StateResult } from '../../../contracts/state/result.js';
import { applyToolCallTransition } from '../../../contracts/state/transitions.js';
import type { ToolCallTransitionRequest } from '../../../contracts/state/transitions.js';
import { recordAttempt } from './attempts.js';
import { admissionConflict, appendEvents, leaseConflict, lockRun, NOT_FOUND } from './run-lock.js';
import type { LockedRun } from './run-lock.js';
import { MS_PARAM, ownerColumns, TOOL_CALL_COLUMNS, toolCallRecord } from './rows.js';
import type { SqlQueryable, SqlPool } from './sql-client.js';
import { sqlConstraint, sqlState, SQLSTATE, withTransaction } from './sql-client.js';
import type { StateConflict } from '../../../contracts/state/result.js';

export interface ToolCallProposal {
  readonly id: ToolCallId;
  readonly runId: RunId;
  readonly stepId: StepId;
  readonly tool: McpToolRef;
  readonly argumentsDigest: ArgumentsDigest;
  readonly requiresApproval: boolean;
  readonly at: number;
  readonly lease?: LeaseToken;
}

/** Row lock for a call of an already locked run; ownership was checked on the run. */
export async function lockToolCall(tx: SqlQueryable, runId: RunId, id: ToolCallId): Promise<ToolCallRecord | undefined> {
  const result = await tx.query(`SELECT ${TOOL_CALL_COLUMNS} FROM viper_engine.tool_calls
    WHERE run_id = $1 AND id = $2 FOR UPDATE`, [runId, id]);
  return result.rows[0] === undefined ? undefined : toolCallRecord(result.rows[0]);
}

/** Persists an accepted transition; the WHERE clause re-asserts compare-and-set. */
export async function writeToolCall(tx: SqlQueryable, before: ToolCallRecord, after: ToolCallRecord): Promise<void> {
  const result = await tx.query(`UPDATE viper_engine.tool_calls
    SET status = $4, attempts = $5, revision = $6, updated_at = ${MS_PARAM(7)}
    WHERE run_id = $1 AND id = $2 AND revision = $3`,
  [after.runId, after.id, before.revision, after.status, after.attempts, after.revision, after.updatedAt]);
  if (result.rowCount !== 1) throw new Error('Tool call row changed while locked');
}

const CALLER_CONNECTION_FK = 'tool_calls_caller_connection_fk';

/**
 * Store-level dispatch invariants checked under the run lock, after ownership:
 * - a terminal or cancel-requested run admits no new dispatch (outcomes may still be recorded);
 * - an approval-required call reaches `dispatching` only via ApprovalStore.consumeForDispatch.
 *   Evidence-gated retries of approved calls need their own explicit policy (not yet built).
 */
function dispatchGate(run: LockedRun, call: ToolCallRecord, request: ToolCallTransitionRequest): StateConflict | undefined {
  if (request.to !== 'dispatching') return undefined;
  const closed = admissionConflict(run.record);
  if (closed !== undefined) return closed;
  if (!call.requiresApproval) return undefined;
  return { code: 'invalid_transition', message: 'Approval-required calls dispatch only by consuming an approval' };
}

export class PostgresToolCallLedger implements ToolCallLedger {
  constructor(private readonly pool: SqlPool) {}

  /** A connection that is not the caller's own (or a server mismatch) is reported as not_found. */
  async propose(scope: TrustedScope, input: ToolCallProposal): Promise<StateResult<ToolCallRecord>> {
    try {
      return await withTransaction(this.pool, async tx => {
        const run = await lockRun(tx, scope, input.runId, 'SHARE');
        if (!run.ok) return stateConflict(run.error);
        const closed = leaseConflict(run.value, input.lease, input.at) ?? admissionConflict(run.value.record);
        if (closed !== undefined) return stateConflict(closed);
        const result = await tx.query(`INSERT INTO viper_engine.tool_calls (run_id, id, actor_id, app_id, tenant_key,
            step_id, status, connection_id, server_id, tool_name, definition_version, arguments_digest,
            requires_approval, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, 'proposed', $7, $8, $9, $10, $11, $12, ${MS_PARAM(13)}, ${MS_PARAM(13)})
          RETURNING ${TOOL_CALL_COLUMNS}`, [
          input.runId, input.id, ...ownerColumns(scope), input.stepId, input.tool.connectionId, input.tool.serverId,
          input.tool.name, input.tool.definitionVersion, input.argumentsDigest, input.requiresApproval, input.at,
        ]);
        return stateOk(toolCallRecord(result.rows[0]));
      });
    } catch (error) {
      // Only the caller-connection FK means "not your connection"; any other violation is a fault.
      if (sqlState(error) === SQLSTATE.foreignKeyViolation && sqlConstraint(error) === CALLER_CONNECTION_FK) {
        return stateConflict(NOT_FOUND);
      }
      throw error;
    }
  }

  async get(scope: TrustedScope, runId: RunId, id: ToolCallId): Promise<StateResult<ToolCallRecord>> {
    return withTransaction(this.pool, async tx => {
      const run = await lockRun(tx, scope, runId, 'SHARE');
      if (!run.ok) return stateConflict(run.error);
      const result = await tx.query(`SELECT ${TOOL_CALL_COLUMNS} FROM viper_engine.tool_calls WHERE run_id = $1 AND id = $2`, [runId, id]);
      return result.rows[0] === undefined ? stateConflict(NOT_FOUND) : stateOk(toolCallRecord(result.rows[0]));
    });
  }

  async listByRun(scope: TrustedScope, runId: RunId): Promise<StateResult<readonly ToolCallRecord[]>> {
    return withTransaction(this.pool, async tx => {
      const run = await lockRun(tx, scope, runId, 'SHARE');
      if (!run.ok) return stateConflict(run.error);
      const result = await tx.query(`SELECT ${TOOL_CALL_COLUMNS} FROM viper_engine.tool_calls
        WHERE run_id = $1 ORDER BY created_at, id`, [runId]);
      return stateOk(Object.freeze(result.rows.map(toolCallRecord)));
    });
  }

  /** `dispatching` commits here, before the caller performs the external MCP call. */
  async transition(scope: TrustedScope, runId: RunId, id: ToolCallId, request: ToolCallTransitionRequest & {
    readonly events: readonly NewRunEvent[];
    readonly lease?: LeaseToken;
  }): Promise<StateResult<ToolCallRecord>> {
    return withTransaction(this.pool, async tx => {
      const run = await lockRun(tx, scope, runId);
      if (!run.ok) return stateConflict(run.error);
      // A stale worker (expired or taken-over lease) must not record dispatch intent or outcomes.
      const lost = leaseConflict(run.value, request.lease, request.at);
      if (lost !== undefined) return stateConflict(lost);
      const current = await lockToolCall(tx, runId, id);
      if (current === undefined) return stateConflict(NOT_FOUND);
      const next = applyToolCallTransition(current, scope, request);
      if (!next.ok) return next;
      // Domain rules come after ownership/revision/transition, as in the reference appliers.
      const gate = dispatchGate(run.value, current, request);
      if (gate !== undefined) return stateConflict(gate);
      await writeToolCall(tx, current, next.value);
      await recordAttempt(tx, scope, current, next.value, request.lease);
      await appendEvents(tx, scope, run.value, request.events);
      return next;
    });
  }
}
