import type { RunId, ToolCallId } from '../../contracts/identity/ids.js';
import type { TrustedScope } from '../../contracts/identity/scope.js';
import type { ToolCall } from '../../contracts/messages/message.js';
import { createFingerprint } from '../../shared/fingerprints/fingerprint.js';
import type { ToolIndex } from '../execution/tool-catalog.js';
import { BudgetExceeded } from './limits.js';
import type { BudgetReason, RunLimits } from './limits.js';
import { parseBudgetState } from './budget-state.js';
import type { BudgetState } from './budget-state.js';

export interface BudgetUsage {
  readonly steps: number;
  readonly toolCalls: number;
  readonly modelOutputBytes: number;
  readonly toolOutputBytes: number;
  readonly corrections: number;
}

/** One invocation's trusted counters; model/tool payloads cannot configure or reset them. */
export class RunBudget {
  private steps = 0;
  private toolCalls = 0;
  private modelOutputBytes = 0;
  private toolOutputBytes = 0;
  private corrections = 0;
  private repeated = new Map<string, number>();
  private readonly calls = new Map<ToolCallId, string>();
  private readonly uncertain = new Set<string>();

  constructor(readonly limits: RunLimits, private readonly scope: TrustedScope, private readonly runId: RunId, saved?: BudgetState) {
    if (saved === undefined) return;
    const state = parseBudgetState(saved);
    this.steps = state.steps; this.toolCalls = state.toolCalls; this.corrections = state.corrections;
    this.modelOutputBytes = state.modelOutputBytes; this.toolOutputBytes = state.toolOutputBytes;
    this.repeated = new Map(state.repeated);
    for (const [id, key] of state.calls) this.calls.set(id, key);
    for (const key of state.uncertain) this.uncertain.add(key);
  }

  exportState(): BudgetState {
    return parseBudgetState({ ...this.snapshot(), repeated: [...this.repeated], calls: [...this.calls], uncertain: [...this.uncertain] });
  }

  step(): void {
    if (this.steps >= this.limits.maxSteps) throw new BudgetExceeded('step_limit');
    this.steps += 1;
  }

  /** Atomic batch reservation before appending proposals: a refused batch leaves no pending IDs. */
  propose(calls: readonly ToolCall[], index: ToolIndex): void {
    if (calls.length > this.limits.maxToolCalls - this.toolCalls) throw new BudgetExceeded('tool_call_limit');
    const next = new Map(this.repeated);
    const keys = calls.map(call => [call.id, this.callKey(call, index)] as const);
    for (const [, key] of keys) {
      const count = (next.get(key) ?? 0) + 1;
      if (count > this.limits.maxRepeatedToolCalls) throw new BudgetExceeded('repetition_limit');
      next.set(key, count);
    }
    for (const [id, key] of keys) this.calls.set(id, key);
    this.repeated = next;
    this.toolCalls += calls.length;
  }

  isUncertain(id: ToolCallId): boolean { return this.uncertain.has(this.calls.get(id) ?? ''); }
  recordUnknown(id: ToolCallId): void {
    const key = this.calls.get(id);
    if (key !== undefined) this.uncertain.add(key);
  }

  correction(reports: readonly { readonly status: string; readonly failureCode?: string }[]): void {
    const repairable = reports.some(report => report.status === 'rejected'
      && ['not_found', 'invalid_value', 'missing_required', 'ambiguous_reference'].includes(report.failureCode ?? ''));
    if (!repairable) return;
    this.corrections += 1;
    if (this.corrections > this.limits.maxCorrections) throw new BudgetExceeded('correction_limit');
  }

  output(kind: 'model' | 'tool', value: unknown): BudgetReason | undefined {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error('Output is not JSON');
    const size = new TextEncoder().encode(serialized).byteLength;
    if (kind === 'model') this.modelOutputBytes = saturatingAdd(this.modelOutputBytes, size);
    else this.toolOutputBytes = saturatingAdd(this.toolOutputBytes, size);
    const maximum = kind === 'model' ? this.limits.maxModelOutputBytes : this.limits.maxToolOutputBytes;
    if (size > maximum) return kind === 'model' ? 'model_output_limit' : 'tool_output_limit';
    if (this.modelOutputBytes > this.limits.maxTotalOutputBytes - this.toolOutputBytes) return 'total_output_limit';
    return undefined;
  }

  snapshot(): BudgetUsage {
    return Object.freeze({ steps: this.steps, toolCalls: this.toolCalls,
      modelOutputBytes: this.modelOutputBytes, toolOutputBytes: this.toolOutputBytes, corrections: this.corrections });
  }

  private callKey(call: ToolCall, index: ToolIndex): string {
    return createFingerprint({
      owner: { actorId: this.scope.actorId, appId: this.scope.appId, tenantId: this.scope.tenantId ?? null },
      runId: this.runId, tool: index.find(call.name)?.definition.ref ?? { alias: call.name }, arguments: call.arguments,
    }, { domain: 'runtime-call', version: 'v1' });
  }
}

function saturatingAdd(left: number, right: number): number {
  return right > Number.MAX_SAFE_INTEGER - left ? Number.MAX_SAFE_INTEGER : left + right;
}
