import type { JsonObject } from '../messages/json.js';
import type { McpContent } from './content.js';

export type McpFailureCode = 'missing_required' | 'invalid_value' | 'wrong_scope' | 'ambiguous_reference'
  | 'not_found' | 'permission' | 'authentication_required' | 'transient' | 'connection_unavailable'
  | 'transport' | 'timeout' | 'unsupported' | 'cancelled' | 'unknown';

export interface McpFailure {
  readonly code: McpFailureCode;
  /** Adapter-sanitized diagnostic; not an instruction or an authorization signal. */
  readonly message: string;
  readonly retryable: boolean;
  readonly field?: string;
}

export type McpOperationResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: McpFailure };

interface ToolOutput {
  readonly content: readonly McpContent[];
  readonly structuredContent?: JsonObject;
  /** Host-private metadata; never automatically insert into model messages or public events. */
  readonly privateMeta?: JsonObject;
}

export type McpToolOutcome =
  | (ToolOutput & { readonly status: 'success' })
  | (ToolOutput & { readonly status: 'error' | 'unknown'; readonly error: McpFailure });
