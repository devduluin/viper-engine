import type { EntityId, RunId, ToolCallId } from '../identity/ids.js';
import { mcpToolKey } from '../mcp/identity.js';
import type { McpToolAnnotations } from '../mcp/catalog.js';
import type { McpToolRef } from '../mcp/identity.js';
import type { JsonObject } from '../messages/json.js';
import type { StateConflict } from './result.js';

export type ApprovalId = EntityId<'approval'>;

/**
 * Full SHA-256 hex digest of canonical final arguments, produced by the application with the
 * shared fingerprint component. It identifies content; it is not a signature or a permit.
 */
export type ArgumentsDigest = string & { readonly __argumentsDigest: true };

/**
 * Fingerprint domain for `ArgumentsDigest` (shared/fingerprints `createFingerprint`). Every
 * producer and verifier must use exactly this domain/version, or bindings will not match.
 */
export const APPROVAL_ARGUMENTS_DIGEST = Object.freeze({ domain: 'approval-arguments', version: 'v1' } as const);

/** What the approver was shown about the tool; stored immutably with the proposal. */
export interface ApprovalToolSnapshot {
  readonly title?: string;
  readonly description?: string;
  readonly inputSchema: JsonObject;
  readonly annotations?: McpToolAnnotations;
}

export function parseArgumentsDigest(value: unknown): ArgumentsDigest {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error('Arguments digest must be 64 lowercase hex characters');
  }
  return value as ArgumentsDigest;
}

export type ApprovalStatus = 'pending' | 'accepted' | 'rejected' | 'expired' | 'superseded' | 'consumed';

export const APPROVAL_STATUSES: readonly ApprovalStatus[] = Object.freeze([
  'pending', 'accepted', 'rejected', 'expired', 'superseded', 'consumed',
]);

/** Accepted approvals are single use: consumption happens atomically with dispatch intent. */
export const APPROVAL_TRANSITIONS: Readonly<Record<ApprovalStatus, readonly ApprovalStatus[]>> = Object.freeze({
  pending: Object.freeze<ApprovalStatus[]>(['accepted', 'rejected', 'expired', 'superseded']),
  accepted: Object.freeze<ApprovalStatus[]>(['consumed', 'expired', 'superseded']),
  rejected: Object.freeze<ApprovalStatus[]>([]),
  expired: Object.freeze<ApprovalStatus[]>([]),
  superseded: Object.freeze<ApprovalStatus[]>([]),
  consumed: Object.freeze<ApprovalStatus[]>([]),
});

/** Immutable proposal snapshot. Any change to these fields requires a new approval. */
export interface ApprovalBinding {
  readonly runId: RunId;
  readonly toolCallId: ToolCallId;
  readonly tool: McpToolRef;
  readonly argumentsDigest: ArgumentsDigest;
}

export function checkApprovalTransition(from: ApprovalStatus, to: ApprovalStatus): StateConflict | undefined {
  if (APPROVAL_TRANSITIONS[from].includes(to)) return undefined;
  return { code: 'invalid_transition', message: `Approval cannot move from ${from} to ${to}` };
}

/** True when `now` (epoch ms) is at or after expiry. */
export function isApprovalExpired(expiresAt: number, now: number): boolean {
  return now >= expiresAt;
}

/**
 * Exact binding comparison: run, tool call, connection/server/tool name/definition version
 * and final-argument digest must all match. Model or tool text can never supply a match.
 */
export function checkApprovalBinding(approved: ApprovalBinding, candidate: ApprovalBinding): StateConflict | undefined {
  const same = approved.runId === candidate.runId
    && approved.toolCallId === candidate.toolCallId
    && mcpToolKey(approved.tool) === mcpToolKey(candidate.tool)
    && approved.argumentsDigest === candidate.argumentsDigest;
  return same ? undefined : { code: 'approval_mismatch', message: 'Approval does not bind this exact call' };
}
