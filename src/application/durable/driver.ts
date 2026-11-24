import { scopeFromAuthenticatedIdentity } from '../../contracts/identity/scope.js';
import { createLoopContext } from '../../agent/runtime/context.js';
import { parseLeaseDuration, parseWorkerId } from '../../contracts/state/leases.js';
import { LeaseGuard, LeaseInterrupted } from './lease-guard.js';
import { DurableSession, JournalError } from './session.js';
import { decodeState, initialState } from './state.js';
import { persistEvent } from './events.js';
import { policy, policyRejection } from './approval-policy.js';
import { recover } from './recovery.js';
import { continueRun, stop } from './continue.js';
import type { DriverResult, DurableDriverDependencies } from './types.js';
import type { RunClaim } from '../../contracts/state/leases.js';
import { isTerminalRunStatus } from '../../contracts/state/run-state.js';
import { deliveryPlan } from './plan.js';
import { contextPlan, resumeContext } from './context-state.js';
import { parseApprovalTtl } from '../runs/approval-ttl.js';
import { takeSteering } from './steering.js';
import { subAgentWiring } from './agents.js';

function shouldYield(error: unknown, guard: LeaseGuard): boolean {
  if (guard.interrupted || error instanceof LeaseInterrupted) return true;
  // steering_pending: a stop met a waiting user message; the next delivery appends it before concluding.
  return error instanceof JournalError && ['lease_lost', 'revision_conflict', 'steering_pending'].includes(error.code);
}

/** One durable work delivery. Hosting/polling/HTTP are separate P06 concerns. */
export class DurableRunDriver {
  constructor(private readonly deps: DurableDriverDependencies) {
    const leaseMs = parseLeaseDuration(deps.leaseMs ?? 30000);
    const heartbeat = deps.heartbeatMs ?? Math.floor(leaseMs / 3);
    if (!Number.isSafeInteger(heartbeat) || heartbeat < 1 || heartbeat >= leaseMs / 2) throw new RangeError('Invalid heartbeat interval');
    parseApprovalTtl(deps.approvalTtlMs);
  }

  async runOnce(workerId: string, shutdown?: AbortSignal): Promise<DriverResult> {
    parseWorkerId(workerId);
    if (shutdown?.aborted) return { kind: 'idle' };
    const claim = await this.deps.leases.claimNext(workerId, this.deps.clock.now(), this.deps.leaseMs ?? 30000);
    if (claim === undefined) return { kind: 'idle' };
    const scope = scopeFromAuthenticatedIdentity(claim.owner);
    const guard = new LeaseGuard(claim, scope, this.deps, shutdown);
    guard.start();
    let session: DurableSession | undefined;
    try {
      session = await this.prepare(claim, guard);
      return await this.execute(session);
    } catch (error) {
      return await this.failure(error, claim, guard, session);
    } finally {
      session?.context?.control.close();
      await guard.close();
      await this.deps.leases.release(claim.runId, claim.lease, this.deps.clock.now()).catch(() => undefined);
    }
  }

  private async execute(session: DurableSession): Promise<DriverResult> {
    const recovered = await recover(session);
    session.syncHistory();
    const result = session.guard.cancelled ? await stop(session, { status: 'cancelled', reason: 'cancelled' })
      : recovered === 'unknown' ? await stop(session, { status: 'partial', reason: 'unknown_outcome' }) : await continueRun(session);
    return { kind: 'settled', runId: session.claim.runId, status: result.status, reason: result.reason };
  }

  private async failure(error: unknown, claim: RunClaim, guard: LeaseGuard, session?: DurableSession): Promise<DriverResult> {
    if (shouldYield(error, guard)) return { kind: 'yielded', runId: claim.runId };
    if (error instanceof JournalError) await guard.refresh().catch(() => undefined);
    if (guard.interrupted) return { kind: 'yielded', runId: claim.runId };
    if (session === undefined || !session.guard.cancelled) {
      await this.deps.onDeliveryFailure?.(claim, error);
      throw error;
    }
    const loaded = await this.deps.checkpoints.load(session.scope, claim.runId);
    if (loaded.ok) session.restore(loaded.value);
    if (isTerminalRunStatus(session.checkpoint.run.status)) return { kind: 'settled', runId: claim.runId, status: session.checkpoint.run.status, reason: 'cancelled' };
    const result = await stop(session, { status: 'cancelled', reason: 'cancelled' });
    return { kind: 'settled', runId: claim.runId, status: result.status, reason: result.reason };
  }

  private async prepare(claim: RunClaim, guard: LeaseGuard): Promise<DurableSession> {
    const scope = scopeFromAuthenticatedIdentity(claim.owner);
    const loaded = await this.deps.checkpoints.load(scope, claim.runId);
    if (!loaded.ok) throw new JournalError(loaded.error.code);
    const wiring = await subAgentWiring(this.deps.subAgents, { scope, runId: claim.runId, ids: this.deps.ids,
      now: () => this.deps.clock.now(), cancelled: guard.cancelled }, await deliveryPlan(this.deps, scope, loaded.value, guard));
    const plan = wiring.plan;
    if (loaded.value.execution === undefined && loaded.value.toolCalls.length > 0) throw new Error('Execution requires a managed checkpoint');
    const state = loaded.value.execution === undefined ? initialState(plan, this.deps.clock.now()) : decodeState(loaded.value.execution.state);
    const runDeps = await this.bindRunModel(state, loaded.value.execution !== undefined, guard.cancelled, claim.runId);
    const context = contextPlan(state, plan, loaded.value, guard.cancelled);
    const session = new DurableSession(claim, scope, runDeps, loaded.value, state, guard);
    await guard.refresh();
    await session.commit(loaded.value.run.status === 'queued' ? [{ kind: 'run_transition', input: {
      to: 'running', expectedRevision: loaded.value.run.revision, at: this.deps.clock.now(), events: [session.event('run.started')] } }] : []);
    session.context = createLoopContext({ ...plan, ...context, scope, runId: claim.runId, conversationId: claim.conversationId,
      model: state.model, maxModelCalls: state.maxModelCalls, maxOutputTokens: state.maxOutputTokens, limits: state.limits, deadlineAt: state.deadlineAt,
      history: { scope, conversationId: claim.conversationId, messages: session.checkpoint.history },
      signal: guard.controller.signal, resume: { budget: state.budget, modelCalls: state.modelCalls, reports: state.reports, ...resumeContext(state) },
    }, { ...runDeps, policy: { decide: (tool, call) => policy(session, tool, call),
      rejection: (tool, call) => policyRejection(session, tool, call) },
      beforeToolInvoke: (tool, call) => { guard.assert(); return this.deps.beforeToolInvoke?.(tool, call); },
      ...(this.deps.steeringInputs === undefined ? {} : { steering: { take: () => takeSteering(session) } }),
      ...(wiring.agents === undefined ? {} : { agents: wiring.agents }),
      onEvent: event => persistEvent(session, event) });
    return session;
  }

  private async bindRunModel(state: ReturnType<typeof initialState>, resumed: boolean, cancelled: boolean, runId: RunClaim['runId']): Promise<DurableDriverDependencies> {
    if (cancelled || this.deps.resolveRunModel === undefined) return this.deps;
    const pinned = state.provider === undefined ? undefined : { provider: state.provider, model: state.model };
    const binding = await this.deps.resolveRunModel(pinned, runId);
    if (resumed && (binding.model !== state.model || (pinned !== undefined && binding.provider !== pinned.provider))) {
      throw new Error('The model pinned to this run is unavailable');
    }
    state.provider = binding.provider;
    state.model = binding.model;
    return { ...this.deps, provider: binding.provider, model: binding.gateway };
  }
}
