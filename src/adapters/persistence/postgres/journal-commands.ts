import type { JournalCommand } from '../../../contracts/state/journal.js';
import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type { RunId, ConversationId } from '../../../contracts/identity/ids.js';
import type { LeaseToken } from '../../../contracts/state/leases.js';
import type { StateResult } from '../../../contracts/state/result.js';
import { PostgresApprovalStore } from './approval-store.js';
import { PostgresToolCallLedger } from './tool-call-ledger.js';
import { PostgresRunStore } from './run-store.js';
import { PostgresMessageStore } from './message-store.js';
import { PostgresExecutionLedger } from './execution-ledger.js';
import type { SqlPool, SqlQueryable } from './sql-client.js';

/** Reuses reviewed stores without nested BEGIN/COMMIT; any command conflict is thrown by journal. */
export function transactionPool(tx: SqlQueryable): SqlPool {
  return { query: (text, values) => tx.query(text, values), transaction: work => work(tx),
    connect: async () => { throw new Error('Transaction-bound stores cannot acquire a new connection'); } };
}

export interface JournalContext {
  readonly pool: SqlPool; readonly scope: TrustedScope; readonly runId: RunId;
  readonly conversationId: ConversationId; readonly lease: LeaseToken; readonly at: number;
}

export function applyCommand(ctx: JournalContext, command: JournalCommand): Promise<StateResult<unknown>> {
  const { scope, runId, lease, at, pool } = ctx;
  switch (command.kind) {
    case 'messages': return new PostgresMessageStore(pool).append(scope, ctx.conversationId, { ...command.input, runId, lease, at });
    case 'run_transition': return new PostgresRunStore(pool).transition(scope, runId, { ...command.input, lease, at });
    case 'tool_proposal': return new PostgresToolCallLedger(pool).propose(scope, { ...command.input, runId, lease, at });
    case 'tool_transition': return new PostgresToolCallLedger(pool).transition(scope, runId, command.id, { ...command.input, lease, at });
    case 'approval_proposal':
      if (command.input.binding.runId !== runId) throw new Error('Cross-run approval command');
      return new PostgresApprovalStore(pool).propose(scope, { ...command.input, lease, at });
    case 'approval_consume':
      if (command.input.binding.runId !== runId) throw new Error('Cross-run approval command');
      return new PostgresApprovalStore(pool).consumeForDispatch(scope, command.id, { ...command.input, lease, at });
    default: return auditCommand(ctx, command);
  }
}

function auditCommand(ctx: JournalContext, command: Extract<JournalCommand, { kind: 'step_start' | 'step_finish' | 'model_start' | 'model_finish' }>): Promise<StateResult<unknown>> {
  const ledger = new PostgresExecutionLedger(ctx.pool);
  const input = { ...command.input, runId: ctx.runId, lease: ctx.lease, at: ctx.at };
  switch (command.kind) {
    case 'step_start': return ledger.startStep(ctx.scope, { ...command.input, ...input });
    case 'step_finish': return ledger.finishStep(ctx.scope, { ...command.input, runId: ctx.runId, lease: ctx.lease, at: ctx.at });
    case 'model_start': return ledger.startModelCall(ctx.scope, { ...command.input, runId: ctx.runId, lease: ctx.lease, at: ctx.at });
    case 'model_finish': return ledger.finishModelCall(ctx.scope, { ...command.input, runId: ctx.runId, lease: ctx.lease, at: ctx.at });
  }
}
