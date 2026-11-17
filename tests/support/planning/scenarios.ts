import type { ModelResult } from '../../../src/contracts/models/gateway.js';
import type { McpToolOutcome } from '../../../src/contracts/mcp/outcome.js';
import type { ToolCallPolicy } from '../../../src/agent/execution/plan-call.js';
import { callsOf, decided, finalText, success, toolError } from '../../unit/runtime/harness.js';
import { checklist } from './plan.js';

export interface PlanningCase {
  readonly id: string;
  readonly frames: readonly ModelResult[];
  readonly outcome: McpToolOutcome;
  readonly policy?: ToolCallPolicy;
  readonly expected: { readonly status: string; readonly modelCalls: number; readonly toolCalls: number };
  readonly plan: ReturnType<typeof checklist>;
}
/** Fixed responses are independent of plan presence. These cases cannot measure semantic quality. */
export function planningCases(): readonly PlanningCase[] {
  return [
    { id: 'simple-read', frames: [callsOf(['read', 'lookup']), finalText('Stock is 5')], outcome: success({ stock: 5 }),
      expected: { status: 'completed', modelCalls: 2, toolCalls: 1 }, plan: checklist('Read the requested stock and return its value.') },
    { id: 'dependent-reads', frames: [callsOf(['read', 'lookup', { id: 'a' }]), callsOf(['detail', 'lookup', { id: 'detail-a' }]), finalText('Combined result: 5')],
      outcome: success({ id: 'detail-a', stock: 5 }), expected: { status: 'completed', modelCalls: 3, toolCalls: 2 }, plan: checklist('Read the record, inspect its referenced detail, then answer.') },
    { id: 'missing-input', frames: [decided({ kind: 'needs_input', question: 'Which record?' })], outcome: success({}),
      expected: { status: 'waiting_for_input', modelCalls: 1, toolCalls: 0 }, plan: checklist('Use the requested record; ask for its ID if missing.') },
    { id: 'approval-write', frames: [callsOf(['write', 'save', { count: 5 }])], outcome: success({ writes: 1 }), policy: { decide: () => 'requires_approval' },
      expected: { status: 'waiting_for_approval', modelCalls: 1, toolCalls: 0 }, plan: checklist('Complete the requested write only after separate exact approval.') },
    { id: 'unknown-outcome', frames: [callsOf(['write', 'save']), finalText('The outcome is uncertain')],
      outcome: { status: 'unknown', content: [], error: { code: 'timeout', message: 'Synthetic unknown outcome', retryable: false } },
      expected: { status: 'partial', modelCalls: 2, toolCalls: 1 }, plan: checklist('Report unknown outcome; do not repeat the external write.') },
    { id: 'failed-tool', frames: [callsOf(['read', 'lookup']), finalText('Could not verify requested data')], outcome: toolError(),
      expected: { status: 'failed', modelCalls: 2, toolCalls: 1 }, plan: checklist('Report tool failure without claiming a successful result.') },
  ];
}
