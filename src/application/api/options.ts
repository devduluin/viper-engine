import type { Clock, IdGenerator } from '../../contracts/identity/ports.js';
import type { TrustedScope } from '../../contracts/identity/scope.js';
import type { JsonObject } from '../../contracts/messages/json.js';
import type { Message } from '../../contracts/messages/message.js';
import type { ReferenceMediaSource } from '../../contracts/messages/content.js';
import type { ApiDatabase, ApiCursorPort } from '../../contracts/api/control.js';

export interface ApiOptions {
  readonly database: ApiDatabase; readonly cursors: ApiCursorPort; readonly clock: Clock; readonly ids: IdGenerator;
  readonly requestBytes: number; readonly eventBytes: number;
  readonly idempotencyRetentionSeconds: number; readonly eventRetentionSeconds: number;
  readonly eventReplay?: boolean;
  readonly queuedModel?: (scope: TrustedScope) => Promise<{ readonly provider: string; readonly model: string }>;
  /** Host grant after authenticating the configured server; no client secret/config accepted. */
  readonly authorizeServer: (scope: TrustedScope, serverId: string) => Promise<'ready' | 'authentication_required' | false>;
  /** Read-only, bounded, application-controlled MCP resource/prompt preparation. */
  readonly prepareContext?: (scope: TrustedScope, selection: JsonObject) => Promise<readonly Message[]>;
  readonly authorizeMedia?: (scope: TrustedScope, source: ReferenceMediaSource) => Promise<boolean>;
  /** Host-provided short-title generator (e.g. a small model call); absent = only user renames. */
  /** Rendezvous for client tool answers; default: this process's broker. */
  readonly clientTools?: import('../streaming/client-tools.js').ClientToolBroker;
  readonly titleConversation?: (scope: TrustedScope, exchange: { readonly question: string; readonly answer: string }) => Promise<string>;
}
