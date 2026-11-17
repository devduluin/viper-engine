import type { ConversationId, EntityId, ModelCallId, RunId, StepId, ToolCallId } from '../identity/ids.js';
import type { JsonObject } from '../messages/json.js';
import type { StateConflict } from './result.js';

export type RunEventId = EntityId<'run_event'>;

/** Durable event types from the API contract. Deltas/transient status are not persisted here. */
export type RunEventType =
  | 'run.queued'
  | 'run.started'
  | 'step.started'
  | 'tool.started'
  | 'tool.completed'
  | 'tool.failed'
  | 'run.input_required'
  | 'approval.required'
  | 'message.completed'
  | 'run.completed'
  | 'run.partial'
  | 'run.failed'
  | 'run.cancelled';

export const RUN_EVENT_TYPES: readonly RunEventType[] = Object.freeze([
  'run.queued', 'run.started', 'step.started', 'tool.started', 'tool.completed', 'tool.failed',
  'run.input_required', 'approval.required', 'message.completed',
  'run.completed', 'run.partial', 'run.failed', 'run.cancelled',
]);

/** New event to append in the same transaction as the state change that caused it. */
export interface NewRunEvent {
  readonly eventId: RunEventId;
  readonly type: RunEventType;
  readonly occurredAt: number;
  readonly stepId?: StepId;
  readonly modelCallId?: ModelCallId;
  readonly toolCallId?: ToolCallId;
  /** Bounded, public-safe payload; large output is referenced, never inlined. */
  readonly payload: JsonObject;
}

export interface RunEventRecord extends NewRunEvent {
  readonly runId: RunId;
  readonly conversationId: ConversationId;
  /** Monotonic per run, starting at 1, gap-free. */
  readonly sequence: number;
}

/** `lastSequence` is 0 for a run with no events. The next event must be exactly last + 1. */
export function checkNextEventSequence(lastSequence: number, next: number): StateConflict | undefined {
  if (Number.isSafeInteger(lastSequence) && lastSequence >= 0 && Number.isSafeInteger(next) && next === lastSequence + 1) return undefined;
  return { code: 'sequence_conflict', message: `Event sequence ${next} does not follow ${lastSequence}` };
}
