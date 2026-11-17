import type { ContentBlock } from '../messages/content.js';
import type { JsonObject } from '../messages/json.js';
import type { RunStatus } from '../state/run-state.js';
import type { ApprovalStatus } from '../state/approval-state.js';
import type { RunUsage } from '../models/run-usage.js';
import type { ContextReport } from '../context/checkpoint.js';

export interface ToolRefView { readonly connectionId: string; readonly serverId: string; readonly name: string; readonly definitionVersion: string }
export interface ProposalView { readonly runId: string; readonly toolCallId: string; readonly tool: ToolRefView; readonly argumentsDigest: string }
export interface ApprovalView {
  readonly schemaVersion: 1; readonly approvalId: string; readonly revision: number; readonly status: ApprovalStatus;
  readonly proposal: ProposalView; readonly arguments: JsonObject; readonly expiresAt: number;
}
export interface ToolCallView { readonly id: string; readonly name: string; readonly arguments: JsonObject }
export type PublicMessageView =
  | { readonly id: string; readonly role: 'user'; readonly content: readonly ContentBlock[] }
  | { readonly id: string; readonly role: 'assistant'; readonly content: readonly ContentBlock[]; readonly toolCalls?: readonly ToolCallView[] }
  | { readonly id: string; readonly role: 'tool'; readonly content: readonly ContentBlock[]; readonly toolCallId: string; readonly outcome: 'success' | 'error' | 'unknown' };
export interface ConversationView {
  readonly schemaVersion: 1; readonly conversationId: string; readonly revision: number; readonly createdAt: number; readonly updatedAt: number;
  readonly title?: string; readonly messages: readonly PublicMessageView[]; readonly nextCursor?: string;
}
export interface RunAcceptedView {
  readonly schemaVersion: 1; readonly runId: string; readonly conversationId: string;
  readonly status: RunStatus; readonly revision: number; readonly snapshotUrl: string;
}
export interface RunSnapshotView {
  readonly schemaVersion: 1; readonly runId: string; readonly conversationId: string; readonly status: RunStatus;
  readonly revision: number; readonly createdAt: number; readonly updatedAt: number;
  readonly eventCursor: string; readonly lastEventSequence: number; readonly cancelRequestedAt?: number;
  readonly inputQuestion?: string; readonly pendingApprovals?: readonly ApprovalView[];
  readonly finalMessage?: Extract<PublicMessageView, { role: 'assistant' }>; readonly usage?: RunUsage;
  readonly context?: ContextReport;
}
export interface ConnectionView {
  readonly schemaVersion: 1; readonly connectionId: string; readonly serverId: string; readonly revision: number;
  readonly authState: 'ready' | 'authentication_required' | 'revoked'; readonly createdAt: number; readonly updatedAt: number;
}
export interface ConnectionPageView { readonly schemaVersion: 1; readonly items: readonly ConnectionView[]; readonly nextCursor?: string }
export interface CapabilitiesView {
  readonly schemaVersion: 1; readonly apiVersion: 'v1';
  readonly features: { readonly tools: boolean; readonly resources: boolean; readonly prompts: boolean; readonly durableRuns: boolean; readonly eventReplay: boolean };
  readonly limits: { readonly requestBytes: number; readonly eventBytes: number; readonly idempotencyRetentionSeconds: number; readonly eventRetentionSeconds: number };
}
export interface DurableEventView {
  readonly schemaVersion: 1; readonly eventId: string; readonly sequence: number; readonly conversationId: string; readonly runId: string;
  readonly occurredAt: number; readonly type: string; readonly payload: JsonObject;
  readonly stepId?: string; readonly modelCallId?: string; readonly toolCallId?: string;
}
