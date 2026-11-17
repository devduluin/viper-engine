import { parseId } from '../../../src/contracts/identity/ids.js';
import { scopeFromAuthenticatedIdentity } from '../../../src/contracts/identity/scope.js';
import type { TrustedScope } from '../../../src/contracts/identity/scope.js';
import type { McpToolRef } from '../../../src/contracts/mcp/identity.js';
import { parseArgumentsDigest } from '../../../src/contracts/state/approval-state.js';
import type { ApprovalBinding } from '../../../src/contracts/state/approval-state.js';
import { ownerFromScope } from '../../../src/contracts/state/owner.js';
import type { ApprovalRecord, RunRecord, ToolCallRecord } from '../../../src/contracts/state/records.js';

export const T0 = Date.UTC(2026, 10, 16, 5, 0);

export function scope(actor = 'actor-1', tenant?: string): TrustedScope {
  const identity = { actorId: parseId('actor', actor), appId: parseId('app', 'app-1') };
  return scopeFromAuthenticatedIdentity(tenant === undefined ? identity : { ...identity, tenantId: parseId('tenant', tenant) });
}

export const digestA = parseArgumentsDigest('a'.repeat(64));
export const digestB = parseArgumentsDigest('b'.repeat(64));

export function toolRef(overrides: Partial<McpToolRef> = {}): McpToolRef {
  return {
    connectionId: parseId('mcp_connection', 'conn-1'),
    serverId: parseId('mcp_server', 'server-1'),
    name: 'create_invoice',
    definitionVersion: 'v1',
    ...overrides,
  };
}

export function binding(overrides: Partial<ApprovalBinding> = {}): ApprovalBinding {
  return {
    runId: parseId('run', 'run-1'),
    toolCallId: parseId('tool_call', 'call-1'),
    tool: toolRef(),
    argumentsDigest: digestA,
    ...overrides,
  };
}

export function runRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return Object.freeze({
    id: parseId('run', 'run-1'),
    conversationId: parseId('conversation', 'conv-1'),
    owner: ownerFromScope(scope()),
    status: 'running',
    revision: 3,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  });
}

export function toolCallRecord(overrides: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return Object.freeze({
    id: parseId('tool_call', 'call-1'),
    runId: parseId('run', 'run-1'),
    stepId: parseId('step', 'step-1'),
    owner: ownerFromScope(scope()),
    status: 'proposed',
    revision: 1,
    tool: toolRef(),
    argumentsDigest: digestA,
    requiresApproval: false,
    attempts: 0,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  });
}

export function approvalRecord(overrides: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return Object.freeze({
    id: parseId('approval', 'approval-1'),
    owner: ownerFromScope(scope()),
    status: 'pending',
    revision: 1,
    binding: binding(),
    expiresAt: T0 + 60_000,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  });
}
