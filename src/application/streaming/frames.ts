import type { JsonObject } from '../../contracts/messages/json.js';

/** Ephemeral run frames: never persisted or replayed, never move a cursor (see delta-bus). */
export interface MessageDeltaFrame {
  readonly schemaVersion: 1;
  readonly type: 'message.delta';
  readonly conversationId: string;
  readonly runId: string;
  readonly stepId: string;
  readonly modelCallId: string;
  /** Deltas are grouped per model call; the final message id is only known at message.completed. */
  readonly messageId: string;
  readonly occurredAt: number;
  readonly delta: string;
}

/** Ephemeral SSE frame asking the client to run a tool (no id: never replayed, never moves a cursor). */
export interface ClientToolRequestFrame {
  readonly schemaVersion: 1;
  readonly type: 'client_tool.request';
  readonly conversationId: string;
  readonly runId: string;
  readonly toolCallId: string;
  readonly name: string;
  readonly arguments: JsonObject;
  readonly expiresAt: number;
}

/** Any ephemeral run frame: provisional text or a client tool request. */
export type EphemeralFrame = MessageDeltaFrame | ClientToolRequestFrame;
