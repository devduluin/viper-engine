import type { ConversationId, RunId, MessageId } from '../identity/ids.js';
import type { TrustedScope } from '../identity/scope.js';
import type { Message } from '../messages/message.js';
import type { NewRunEvent } from './events.js';
import type { LeaseToken } from './leases.js';
import type { ApprovalRecord, RunRecord, ToolCallRecord } from './records.js';
import type { StateResult } from './result.js';
import type { RunUsage } from '../models/run-usage.js';

export interface StoredMessage {
  readonly message: Message;
  /** 1-based, gap-free per conversation; the stable history order. */
  readonly position: number;
  readonly runId?: RunId;
  readonly createdAt: number;
}

export interface MessageAppend {
  /** Conversation revision the caller read; appends are compare-and-set. */
  readonly expectedRevision: number;
  readonly at: number;
  /** Required for messages produced by a run; a terminal run accepts no more messages. */
  readonly runId?: RunId;
  /** User, assistant and tool messages only: system instructions are never persisted history. */
  readonly messages: readonly Message[];
  /** Run events committed with the messages (requires `runId`). */
  readonly events?: readonly NewRunEvent[];
  readonly lease?: LeaseToken;
}

/**
 * Append-only conversation history. Every append keeps call/result pairing valid across the whole
 * conversation (no orphan or duplicate results, no reused call IDs).
 */
export interface MessageStore {
  append(scope: TrustedScope, conversationId: ConversationId, input: MessageAppend): Promise<StateResult<{
    readonly revision: number; readonly positions: readonly number[];
  }>>;
  read(scope: TrustedScope, conversationId: ConversationId, afterPosition: number, limit: number): Promise<StateResult<{
    readonly revision: number; readonly messages: readonly StoredMessage[];
  }>>;
}

/** Everything a driver needs to resume a run, read from one consistent snapshot. */
export interface RunCheckpoint {
  readonly usage?: RunUsage;
  readonly run: RunRecord;
  readonly conversationRevision: number;
  readonly history: readonly Message[];
  readonly runMessageIds: readonly MessageId[];
  readonly toolCalls: readonly ToolCallRecord[];
  readonly approvals: readonly ApprovalRecord[];
  /** Events with sequence <= this are part of the snapshot; stream from here. */
  readonly lastEventSequence: number;
  readonly execution?: { readonly revision: number; readonly state: import('../messages/json.js').JsonObject };
}

export interface CheckpointReader {
  /** Fails with RangeError above `maxMessages` instead of loading an unbounded history. */
  load(scope: TrustedScope, runId: RunId, options?: { readonly maxMessages?: number }): Promise<StateResult<RunCheckpoint>>;
}
