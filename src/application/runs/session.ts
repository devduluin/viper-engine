import { assertSameScope } from '../../contracts/identity/scope.js';
import type { TrustedScope } from '../../contracts/identity/scope.js';
import { checkExpectedRevision } from '../../contracts/state/result.js';
import { createLoopContext } from '../../agent/runtime/context.js';
import { driveAgentLoop, snapshotLoopResult } from '../../agent/runtime/run-loop.js';
import { resumeAgentCalls } from '../../agent/runtime/resume.js';
import type { RunLoopInput } from '../../agent/runtime/types.js';
import { capturePause, sessionView } from './session-view.js';
import { activateSession, removePendingReports } from './session-lifecycle.js';
import { inputFingerprint, submitSessionInput } from './session-input.js';
import { decideSessionApproval, resumeSessionApproval } from './session-approval.js';
import { reviseSessionProposal } from './session-revise.js';
import { beforeInitialInvoke } from './session-policy.js';
import { SessionError } from './session-state.js';
import { parseApprovalTtl } from './approval-ttl.js';
import type {
  ApprovalDecision, InputAction, ReviseProposal, SessionDependencies, SessionState, SessionView,
} from './session-state.js';

/** Ephemeral single-run application controller. No JSON hydration or production persistence. */
export class AgentRunSession {
  private constructor(private readonly state: SessionState) {}

  static async start(input: RunLoopInput, deps: SessionDependencies, ttlMs?: number): Promise<AgentRunSession> {
    const approvalTtlMs = parseApprovalTtl(ttlMs);
    const cancellation = new AbortController();
    const signals = input.signal === undefined ? [cancellation.signal] : [cancellation.signal, input.signal];
    const context = createLoopContext({ ...input, signal: AbortSignal.any(signals) }, {
      ...deps, beforeToolInvoke: (tool, call) => beforeInitialInvoke(deps, tool, call),
    });
    try {
      const result = await driveAgentLoop(context);
      const state: SessionState = { context, result, revision: 1, busy: false, poisoned: false,
        deps, approvalTtlMs, approvals: new Map(), pending: new Map(), inputs: new Map(), cancellation,
      };
      capturePause(state);
      return new AgentRunSession(state);
    } finally { context.control.close(); }
  }

  snapshot(scope: TrustedScope): SessionView {
    this.assertAccess(scope);
    if (this.state.busy) throw new SessionError('run_busy');
    return sessionView(this.state);
  }

  async submitInput(scope: TrustedScope, action: InputAction): Promise<SessionView> {
    this.assertAccess(scope);
    const fingerprint = inputFingerprint(action);
    const previous = this.state.inputs.get(action.inputId);
    if (previous !== undefined) {
      if (previous.fingerprint !== fingerprint) throw new SessionError('input_conflict');
      return previous.view;
    }
    const view = await this.command(scope, action.expectedRevision, () => submitSessionInput(this.state, action));
    this.state.inputs.set(action.inputId, Object.freeze({ fingerprint, view }));
    return view;
  }

  async decideApproval(scope: TrustedScope, action: ApprovalDecision): Promise<SessionView> {
    return this.command(scope, undefined, async () => decideSessionApproval(this.state, action));
  }

  async reviseProposal(scope: TrustedScope, action: ReviseProposal): Promise<SessionView> {
    return this.command(scope, undefined, () => reviseSessionProposal(this.state, action));
  }

  async resume(scope: TrustedScope, expectedRevision: number): Promise<SessionView> {
    return this.command(scope, expectedRevision, () => resumeSessionApproval(this.state));
  }

  /** Explicit server/user cancellation; closing an HTTP connection must not call this method. */
  requestCancellation(scope: TrustedScope): void {
    this.assertAccess(scope);
    this.state.cancellation.abort();
  }

  async cancel(scope: TrustedScope): Promise<SessionView> {
    this.assertAccess(scope);
    if (!this.state.result.status.startsWith('waiting_') && !this.state.busy) return sessionView(this.state);
    return this.command(scope, undefined, async () => {
      this.state.cancellation.abort();
      removePendingReports(this.state);
      await activateSession(this.state, async () => {
        const calls = [...this.state.pending.values()].map(held => held.call);
        if (calls.length > 0) return resumeAgentCalls(this.state.context, calls);
        const stop = { status: 'cancelled', reason: 'cancelled' } as const;
        await this.state.context.emit({ type: 'run_stopped', ...stop });
        return snapshotLoopResult(this.state.context, stop);
      });
    });
  }

  private assertAccess(scope: TrustedScope): void {
    assertSameScope(this.state.context.input.scope, scope);
    if (this.state.poisoned) throw new SessionError('invalid_state', 'Session requires durable recovery after an infrastructure fault');
  }

  private async command(scope: TrustedScope, expected: number | undefined, work: () => Promise<void>): Promise<SessionView> {
    this.assertAccess(scope);
    if (this.state.busy) throw new SessionError('run_busy');
    if (expected !== undefined) {
      const conflict = checkExpectedRevision(this.state.revision, expected);
      if (conflict !== undefined) throw new SessionError(conflict.code);
    }
    if (!Number.isSafeInteger(this.state.revision + 1)) throw new RangeError('Session revision overflow');
    this.state.busy = true;
    try {
      await work();
      this.state.revision += 1;
      return sessionView(this.state);
    } finally { this.state.busy = false; }
  }
}
