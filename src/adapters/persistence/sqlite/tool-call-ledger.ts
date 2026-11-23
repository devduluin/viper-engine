import type { RunId, ToolCallId } from '../../../contracts/identity/ids.js';
import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type { ToolCallLedger } from '../../../contracts/state/ports.js';
import type { ToolCallRecord } from '../../../contracts/state/records.js';
import { stateConflict, stateOk } from '../../../contracts/state/result.js';
import type { StateResult } from '../../../contracts/state/result.js';
import { applyToolCallTransition } from '../../../contracts/state/transitions.js';
import { admissionConflict, leaseConflict, NOT_FOUND } from '../postgres/run-lock.js';
import { ownerColumns } from '../postgres/rows.js';
import { withTransaction } from '../postgres/sql-client.js';
import type { SqlPool } from '../postgres/sql-client.js';
import { appendEvents, lockRun } from './run-store.js';
import { callRecord, lockCall, recordAttempt, writeCall } from './tool-call-rows.js';

type Proposal = Parameters<ToolCallLedger['propose']>[1];

export class SqliteToolCallLedger implements ToolCallLedger {
  constructor(private readonly pool: SqlPool, private readonly clock: () => number = Date.now) {}

  async propose(scope: TrustedScope, input: Proposal): Promise<StateResult<ToolCallRecord>> {
    return withTransaction(this.pool, async tx => {
      const run = await lockRun(tx, scope, input.runId, this.clock);
      if (!run.ok) return stateConflict(run.error);
      const closed = leaseConflict(run.value, input.lease, input.at) ?? admissionConflict(run.value.record);
      if (closed !== undefined) return stateConflict(closed);
      const connection = await tx.query(`SELECT id FROM viper_engine.mcp_connections
        WHERE id = ? AND server_id = ? AND actor_id = ? AND app_id = ? AND tenant_key = ?`,
      [input.tool.connectionId, input.tool.serverId, ...ownerColumns(scope)]);
      if (connection.rows.length === 0) return stateConflict(NOT_FOUND);
      const result = await tx.query(`INSERT INTO viper_engine.tool_calls (run_id, id, actor_id, app_id, tenant_key, step_id,
        status, connection_id, server_id, tool_name, definition_version, arguments_digest, requires_approval, created_at_ms, updated_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, 'proposed', ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      [input.runId, input.id, ...ownerColumns(scope), input.stepId, input.tool.connectionId, input.tool.serverId,
        input.tool.name, input.tool.definitionVersion, input.argumentsDigest, input.requiresApproval, input.at, input.at]);
      return stateOk(callRecord(result.rows[0]));
    });
  }

  async get(scope: TrustedScope, runId: RunId, id: ToolCallId): Promise<StateResult<ToolCallRecord>> {
    return withTransaction(this.pool, async tx => {
      const run = await lockRun(tx, scope, runId, this.clock);
      if (!run.ok) return stateConflict(run.error);
      const call = await lockCall(tx, runId, id);
      return call === undefined ? stateConflict(NOT_FOUND) : stateOk(call);
    });
  }

  async listByRun(scope: TrustedScope, runId: RunId): Promise<StateResult<readonly ToolCallRecord[]>> {
    return withTransaction(this.pool, async tx => {
      const run = await lockRun(tx, scope, runId, this.clock);
      if (!run.ok) return stateConflict(run.error);
      const calls = await tx.query('SELECT * FROM viper_engine.tool_calls WHERE run_id = ? ORDER BY created_at_ms, id', [runId]);
      return stateOk(Object.freeze(calls.rows.map(callRecord)));
    });
  }

  async transition(scope: TrustedScope, runId: RunId, id: ToolCallId, request: Parameters<ToolCallLedger['transition']>[3]): Promise<StateResult<ToolCallRecord>> {
    return withTransaction(this.pool, async tx => {
      const run = await lockRun(tx, scope, runId, this.clock);
      if (!run.ok) return stateConflict(run.error);
      const lost = leaseConflict(run.value, request.lease, request.at);
      if (lost !== undefined) return stateConflict(lost);
      const call = await lockCall(tx, runId, id);
      if (call === undefined) return stateConflict(NOT_FOUND);
      const next = applyToolCallTransition(call, scope, request);
      if (!next.ok) return next;
      if (request.to === 'dispatching') {
        const closed = admissionConflict(run.value.record);
        if (closed !== undefined) return stateConflict(closed);
        if (call.requiresApproval) return stateConflict({
          code: 'invalid_transition', message: 'Approval-required calls dispatch only by consuming an approval',
        });
      }
      await writeCall(tx, call, next.value);
      await recordAttempt(tx, scope, call, next.value, request.lease);
      await appendEvents(tx, run.value.record, scope, run.value.lastEventSequence, request.events);
      return next;
    });
  }
}
