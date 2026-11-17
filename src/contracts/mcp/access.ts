import type { TrustedScope } from '../identity/scope.js';
import type { JsonObject } from '../messages/json.js';
import type { StateResult } from '../state/result.js';
import type { McpConnectionId, McpConnectionRef } from './identity.js';

/** Server definition the application stores (`mcp_servers`); secrets are never inline. */
export interface McpServerEndpoint {
  readonly transport: 'stdio' | 'streamable_http';
  /** Opaque reference resolved by bootstrap (a URL or a configured command key). */
  readonly endpointRef: string;
  readonly config: JsonObject;
  readonly enabled: boolean;
}

export type McpAuthState = 'ready' | 'authentication_required' | 'revoked';

/** A connection as seen by its owner. Other owners get `not_found` from the directory. */
export interface McpConnectionRecord {
  readonly connection: McpConnectionRef;
  readonly authState: McpAuthState;
  readonly revision: number;
  readonly server: McpServerEndpoint;
}

/**
 * Per-user connection registry (`mcp_connections`). Every discovery and dispatch path asks it
 * again, so revocation and ownership apply to cached sessions and to resumed runs alike.
 */
export interface McpConnectionDirectory {
  get(scope: TrustedScope, id: McpConnectionId): Promise<StateResult<McpConnectionRecord>>;
  /** The server rejected the credential and refresh failed; the user must re-authorize. */
  markAuthenticationRequired(scope: TrustedScope, id: McpConnectionId, at: number): Promise<StateResult<McpConnectionRecord>>;
  /** Permanent for this connection row; a new authorization creates a new connection. */
  revoke(scope: TrustedScope, id: McpConnectionId, at: number): Promise<StateResult<McpConnectionRecord>>;
}

/** Material handed to a transport for one session; never persisted, logged or sent to a model. */
export type McpCredential =
  | { readonly kind: 'none' }
  | { readonly kind: 'bearer'; readonly token: string }
  | { readonly kind: 'environment'; readonly variables: Readonly<Record<string, string>> };

export type McpCredentialResult =
  | { readonly ok: true; readonly credential: McpCredential }
  | { readonly ok: false; readonly code: 'authentication_required' | 'revoked' };

/**
 * Credential port backed by a secret store / OAuth client. There is no fallback to a shared
 * development account or to another user's connection: failure is reported, never substituted.
 */
export interface McpCredentialPort {
  resolve(scope: TrustedScope, connection: McpConnectionRef): Promise<McpCredentialResult>;
  /** Called at most once after the server rejected `rejected` (HTTP 401); may rotate tokens. */
  refresh(scope: TrustedScope, connection: McpConnectionRef, rejected: McpCredential): Promise<McpCredentialResult>;
}
