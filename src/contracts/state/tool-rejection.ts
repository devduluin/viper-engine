import type { McpFailureCode } from '../mcp/outcome.js';
import { parseMcpFailure } from '../mcp/parse-outcome.js';
import type { TrustedScope } from '../identity/scope.js';
import type { ApprovalRecord } from './records.js';
import type { ApprovalBinding } from './approval-state.js';
import { checkApprovalBinding } from './approval-state.js';
import { checkOwnership } from './owner.js';

/** Host planning evidence, distinct from a remote MCP transport/business error. */
export type ToolFailureCode = McpFailureCode | 'rejected_by_user';
export interface ToolRejection { readonly code: ToolFailureCode; readonly message: string; readonly field?: string }
const DECLINED: ToolRejection = Object.freeze({ code: 'rejected_by_user',
  message: 'The user declined this action. It was not executed. Do not retry it or request broader access to bypass this decision.' });

export function userDeclined(scope: TrustedScope, approval: ApprovalRecord, candidate: ApprovalBinding): ToolRejection | undefined {
  if (approval.status !== 'rejected' || checkOwnership(approval.owner, scope) !== undefined) return undefined;
  return checkApprovalBinding(approval.binding, candidate) === undefined ? DECLINED : undefined;
}
export function parseToolFailureCode(value: unknown): ToolFailureCode {
  if (value === 'rejected_by_user') return value;
  return parseMcpFailure({ code: value, message: 'Restored tool failure', retryable: false }).code;
}
