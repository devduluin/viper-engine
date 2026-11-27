import type { ConversationId, RunId, MessageId } from '../identity/ids.js';

/** A bounded view of immutable history, never a replacement for execution/approval evidence. */
export interface ContextCheckpoint {
  readonly version: 1 | 2; readonly conversationId: ConversationId; readonly runId: RunId;
  readonly preserveFromMessageId: MessageId; readonly coveredMessages: number;
  readonly sourceDigest: string; readonly excerpt: string;
  readonly report: ContextReport;
}
export interface ContextReport {
  readonly inputMessages: number; readonly selectedMessages: number; readonly omittedMessages: number;
  readonly beforeTokens: number; readonly afterTokens: number; readonly inputBytes: number;
  readonly approximate: true; readonly hasUnpricedMedia: boolean; readonly excludesProviderFraming: true;
}
