import type { JournalCommand } from '../../../contracts/state/journal.js';
import type { StateResult } from '../../../contracts/state/result.js';
import type { JournalContext } from '../postgres/journal-commands.js';
import { SqliteApprovalStore } from './approval-store.js';
import { SqliteExecutionLedger } from './execution-ledger.js';
import { SqliteMessageStore } from './message-store.js';
import { SqliteRunStore } from './run-store.js';
import { consumeSteering, settleSteering } from './run-steering.js';
import { SqliteToolCallLedger } from './tool-call-ledger.js';

type Context = JournalContext & { readonly clock: () => number };

export function applyCommand(ctx: Context, command: JournalCommand): Promise<StateResult<unknown>> {
  const { pool, scope, runId, conversationId, clock, lease, at } = ctx;
  switch (command.kind) {
    case 'messages': return new SqliteMessageStore(pool, clock).append(scope, conversationId, { ...command.input, runId, lease, at });
    case 'run_transition': return new SqliteRunStore(pool, clock).transition(scope, runId, { ...command.input, lease, at });
    case 'tool_proposal': return new SqliteToolCallLedger(pool, clock).propose(scope, { ...command.input, runId, lease, at });
    case 'tool_transition': return new SqliteToolCallLedger(pool, clock).transition(scope, runId, command.id, { ...command.input, lease, at });
    case 'approval_proposal': case 'approval_consume': return applyApproval(ctx, command);
    case 'steering_consume': return consumeSteering(pool, runId, command.messageIds, at);
    case 'steering_settle': return settleSteering(pool, runId, command.mode, at);
    default: return applyAudit(ctx, command);
  }
}

function applyApproval(ctx: Context, command: Extract<JournalCommand, { kind: 'approval_proposal' | 'approval_consume' }>): Promise<StateResult<unknown>> {
  if (command.input.binding.runId !== ctx.runId) throw new Error('Cross-run approval command');
  const approvals = new SqliteApprovalStore(ctx.pool, ctx.clock);
  return command.kind === 'approval_proposal'
    ? approvals.propose(ctx.scope, { ...command.input, lease: ctx.lease, at: ctx.at })
    : approvals.consumeForDispatch(ctx.scope, command.id, { ...command.input, lease: ctx.lease, at: ctx.at });
}

function applyAudit(ctx: Context, command: Extract<JournalCommand, { kind: 'step_start' | 'step_finish' | 'model_start' | 'model_finish' }>): Promise<StateResult<unknown>> {
  const ledger = new SqliteExecutionLedger(ctx.pool, ctx.clock);
  const execution = { runId: ctx.runId, at: ctx.at, lease: ctx.lease };
  switch (command.kind) {
    case 'step_start': return ledger.startStep(ctx.scope, { ...command.input, ...execution });
    case 'step_finish': return ledger.finishStep(ctx.scope, { ...command.input, ...execution });
    case 'model_start': return ledger.startModelCall(ctx.scope, { ...command.input, ...execution });
    case 'model_finish': return ledger.finishModelCall(ctx.scope, { ...command.input, ...execution });
  }
}
