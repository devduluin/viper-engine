import type { TrustedScope } from '../identity/scope.js';
import type { ConversationId, RunId } from '../identity/ids.js';
import type { Message } from '../messages/message.js';

/** Trusted host retrieves scoped data afresh before a model call. Data cannot become system authority. */
export type ContextEvidenceProvider = (request: { readonly scope: TrustedScope; readonly conversationId: ConversationId;
  readonly runId: RunId }, options: { readonly signal: AbortSignal }) => Promise<readonly Message[]>;
