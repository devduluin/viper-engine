import type { ConversationId, RunId } from '../identity/ids.js';
import type { TrustedScope } from '../identity/scope.js';
import type { JsonObject } from '../messages/json.js';
import type { Message } from '../messages/message.js';
import type { ConversationRecord, RunRecord } from '../state/records.js';
import type { ConversationStore, RunStore, ApprovalStore } from '../state/ports.js';
import type { MessageStore, CheckpointReader } from '../state/checkpoints.js';
import type { IdempotencyStore } from '../state/idempotency.js';
import type { StateResult } from '../state/result.js';
import type { McpConnectionDirectory } from '../mcp/access.js';

export type ApiOperation = 'createConversation' | 'listConversations' | 'getConversation' | 'startRun' | 'getRun' | 'submitInput'
  | 'cancelRun' | 'decideApproval' | 'createConnection' | 'listConnections' | 'disconnectConnection' | 'getCapabilities';
export interface ApiCall {
  readonly operation: ApiOperation; readonly resourceId?: string; readonly body: JsonObject;
  readonly key?: string; readonly cursor?: string; readonly limit?: number;
}
export interface ApiControlStore {
  lockConversation(scope: TrustedScope, id: ConversationId): Promise<StateResult<ConversationRecord>>;
  lockRun(scope: TrustedScope, id: RunId): Promise<StateResult<RunRecord>>;
  hasActiveRun(id: ConversationId): Promise<boolean>;
  saveInstructions(scope: TrustedScope, runId: RunId, messages: readonly Message[]): Promise<void>;
  inputReceipt(scope: TrustedScope, runId: RunId, inputId: string): Promise<{ readonly fingerprint: string; readonly response: JsonObject } | undefined>;
  saveInputReceipt(scope: TrustedScope, runId: RunId, inputId: string, fingerprint: string, response: JsonObject): Promise<void>;
  createConnection(scope: TrustedScope, serverId: string, id: string, authState: 'ready' | 'authentication_required', at: number): Promise<JsonObject>;
  listConnections(scope: TrustedScope, afterId: string, limit: number): Promise<readonly JsonObject[]>;
  /** Newest first (updatedAt, then id); `after` is the last row of the previous page. Empty conversations are omitted. */
  listConversations(scope: TrustedScope, after: ConversationPosition | undefined, limit: number): Promise<readonly JsonObject[]>;
  disconnectConnection(scope: TrustedScope, id: string, expectedRevision: number, at: number): Promise<JsonObject>;
}
export interface ConversationPosition { readonly updatedAt: number; readonly id: string }
export interface ApiStores {
  readonly conversations: ConversationStore; readonly runs: RunStore; readonly approvals: ApprovalStore;
  readonly messages: MessageStore; readonly checkpoints: CheckpointReader;
  readonly idempotency: IdempotencyStore; readonly control: ApiControlStore;
  readonly connections: McpConnectionDirectory;
}
export interface ApiDatabase {
  transaction<T>(work: (stores: ApiStores) => Promise<T>): Promise<T>;
  snapshot<T>(work: (stores: ApiStores) => Promise<T>): Promise<T>;
}
export interface ApiCursorPort {
  issue(scope: TrustedScope, kind: 'event' | 'messages' | 'connections' | 'conversations', resource: string, position: string): string;
  read(scope: TrustedScope, kind: 'event' | 'messages' | 'connections' | 'conversations', resource: string, token: string): string;
}
export interface ApiHandler { execute(scope: TrustedScope, call: ApiCall): Promise<JsonObject> }
