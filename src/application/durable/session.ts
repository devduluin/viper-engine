import type { RunCheckpoint } from '../../contracts/state/checkpoints.js';
import type { JournalCommand } from '../../contracts/state/journal.js';
import type { TrustedScope } from '../../contracts/identity/scope.js';
import type { RunClaim } from '../../contracts/state/leases.js';
import type { Message, ToolCall } from '../../contracts/messages/message.js';
import type { NewRunEvent, RunEventType } from '../../contracts/state/events.js';
import type { JsonObject } from '../../contracts/messages/json.js';
import type { ToolCallReport } from '../../agent/execution/dispatch.js';
import type { StepContext } from '../../agent/runtime/model-step.js';
import type { DurableDriverDependencies } from './types.js';
import { decodeState, encodeState } from './state.js';
import { createLoopContext } from '../../agent/runtime/context.js';
import type { DurableState } from './state.js';
import type { LeaseGuard } from './lease-guard.js';
import { resumeContext } from './context-state.js';

export class JournalError extends Error {
  constructor(readonly code: string) { super(code); }
}

export class DurableSession {
  context?: StepContext;
  constructor(readonly claim: RunClaim, readonly scope: TrustedScope, readonly deps: DurableDriverDependencies,
    public checkpoint: RunCheckpoint, readonly state: DurableState, readonly guard: LeaseGuard) {}

  async commit(commands: readonly JournalCommand[] = []): Promise<void> {
    this.guard.assert();
    if (this.context !== undefined) {
      this.state.budget = this.context.budget.exportState();
      this.state.modelCalls = this.context.state.modelCalls;
      this.state.toolDiscovery = this.context.discovery.snapshot();
    }
    const result = await this.deps.journal.commit(this.scope, this.claim.runId, { lease: this.claim.lease,
      at: this.deps.clock.now(), expectedRevision: this.checkpoint.execution?.revision ?? 0,
      state: encodeState(this.state), commands });
    if (!result.ok) throw new JournalError(result.error.code);
    this.checkpoint = result.value;
  }

  event(type: RunEventType, payload: JsonObject = {}): NewRunEvent {
    return { eventId: this.deps.ids.next('run_event'), type, occurredAt: this.deps.clock.now(), payload,
      ...(this.state.stepId === undefined ? {} : { stepId: this.state.stepId }) };
  }

  messages(messages: readonly Message[]): JournalCommand[] {
    const fresh = messages.filter(message => !this.checkpoint.history.some(existing => existing.id === message.id));
    return fresh.length === 0 ? [] : [{ kind: 'messages', input: { expectedRevision: this.checkpoint.conversationRevision,
      at: this.deps.clock.now(), messages: fresh, events: fresh.flatMap(message => [
        this.event('message.completed', { messageId: message.id }), ...this.toolResultEvents(message),
      ]) } }];
  }

  private toolResultEvents(message: Message): NewRunEvent[] {
    if (message.role !== 'tool') return [];
    const row = this.checkpoint.toolCalls.find(call => call.id === message.toolCallId);
    const stepId = row?.stepId ?? this.state.stepId;
    if (stepId === undefined) throw new Error('Tool result lacks durable step correlation');
    return [{ ...this.event(message.outcome === 'success' ? 'tool.completed' : 'tool.failed', {
      messageId: message.id, outcome: message.outcome,
    }), stepId, toolCallId: message.toolCallId }];
  }

  report(report: ToolCallReport): void {
    this.state.reports = [...this.state.reports.filter(previous => previous.id !== report.id), report];
  }

  syncHistory(): void {
    if (this.context !== undefined) {
      this.context.state.history.splice(0, this.context.state.history.length, ...this.checkpoint.history);
      this.context.state.reports.splice(0, this.context.state.reports.length, ...this.state.reports);
    }
  }

  restore(checkpoint: RunCheckpoint): void {
    if (checkpoint.execution === undefined) throw new Error('Cannot restore an unmanaged execution');
    this.checkpoint = checkpoint;
    const state = decodeState(checkpoint.execution.state);
    delete this.state.stepId; delete this.state.modelCallId; delete this.state.contextCheckpoint; delete this.state.contextBudget;
    delete this.state.toolDiscovery;
    Object.assign(this.state, state);
    if (this.context === undefined) return;
    const previous = this.context;
    previous.control.close();
    this.context = createLoopContext({ ...previous.input,
      history: { ...previous.input.history, messages: checkpoint.history },
      resume: { modelCalls: state.modelCalls, budget: state.budget, reports: state.reports, ...resumeContext(state) },
    }, previous.deps);
  }

  call(id: string): ToolCall {
    const call = this.checkpoint.history.flatMap(message => message.role === 'assistant' ? message.toolCalls ?? [] : []).find(call => call.id === id);
    if (call === undefined) throw new Error('Ledger call has no persisted assistant proposal');
    return call;
  }
}
