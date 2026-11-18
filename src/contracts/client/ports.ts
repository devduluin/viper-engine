import type { StartRunView, SubmitInputView, DecideApprovalView } from './requests.js';
import type { RunAcceptedView, RunSnapshotView, ConversationView, ApprovalView, ConnectionView,
  ConnectionPageView, CapabilitiesView, DurableEventView, ConversationPageView } from './views.js';

export interface ClientRead { readonly signal?: AbortSignal }
export interface ClientPage extends ClientRead { readonly cursor?: string; readonly limit?: number }
export interface ClientCheckpoint { readonly runId: string; readonly cursor: string; readonly sequence: number }
export interface ClientEvent { readonly event: DurableEventView; readonly cursor: string }
export interface EngineClientPort {
  capabilities(options?: ClientRead): Promise<CapabilitiesView>;
  createConversation(body?: { readonly title?: string }, options?: ClientRead): Promise<ConversationView>;
  conversations(options?: ClientPage): Promise<ConversationPageView>;
  conversation(id: string, options?: ClientPage): Promise<ConversationView>;
  startRun(conversationId: string, body: StartRunView, key: string, options?: ClientRead): Promise<RunAcceptedView>;
  run(id: string, options?: ClientRead): Promise<RunSnapshotView>;
  submitInput(runId: string, body: SubmitInputView, options?: ClientRead): Promise<RunAcceptedView>;
  cancel(runId: string, options?: ClientRead): Promise<RunSnapshotView>;
  decideApproval(id: string, body: DecideApprovalView, options?: ClientRead): Promise<ApprovalView>;
  createConnection(serverId: string, options?: ClientRead): Promise<ConnectionView>;
  connections(options?: ClientPage): Promise<ConnectionPageView>;
  disconnect(id: string, expectedRevision: number, options?: ClientRead): Promise<ConnectionView>;
  events(runId: string, options?: ClientRead & { readonly cursor?: string }): AsyncIterable<ClientEvent>;
}
export type ClientUpdate =
  | { readonly kind: 'snapshot'; readonly snapshot: RunSnapshotView; readonly recovered: boolean }
  | { readonly kind: 'event'; readonly event: DurableEventView; readonly checkpoint: ClientCheckpoint };
export interface WatchOptions extends ClientRead {
  readonly checkpoint?: ClientCheckpoint;
  readonly maxReconnects?: number; readonly reconnectMs?: number; readonly maxReconnectMs?: number;
}
