import { parseId } from '../../../contracts/identity/ids.js';
import { parseJsonObject } from '../../../contracts/messages/json.js';
import type { TrustedScope } from '../../../contracts/identity/scope.js';
import { parseArgumentsDigest } from '../../../contracts/state/approval-state.js';
import type { OwnerScope } from '../../../contracts/state/owner.js';
import { ownerFromScope } from '../../../contracts/state/owner.js';
import type {
  ApprovalRecord, ConversationRecord, RunRecord, ToolCallRecord,
} from '../../../contracts/state/records.js';
import type { ApprovalStatus, ApprovalToolSnapshot } from '../../../contracts/state/approval-state.js';
import { APPROVAL_STATUSES } from '../../../contracts/state/approval-state.js';
import type { RunStatus } from '../../../contracts/state/run-state.js';
import { RUN_STATUSES } from '../../../contracts/state/run-state.js';
import type { ToolCallStatus } from '../../../contracts/state/tool-call-state.js';
import { TOOL_CALL_STATUSES } from '../../../contracts/state/tool-call-state.js';

/** Timestamps cross the boundary as exact integer epoch milliseconds. */
export const msColumn = (column: string) => `round(extract(epoch FROM ${column}) * 1000)::bigint AS ${column}_ms`;
export const MS_PARAM = (index: number) => `(timestamptz 'epoch' + $${index}::bigint * interval '1 millisecond')`;

const OWNED = ['actor_id', 'app_id', 'tenant_key', 'revision', msColumn('created_at'), msColumn('updated_at')];
export const CONVERSATION_COLUMNS = ['id', 'title', ...OWNED].join(', ');
export const RUN_COLUMNS = ['id', 'conversation_id', 'status', msColumn('cancel_requested_at'), 'last_event_sequence',
  'lease_owner', 'lease_fence', msColumn('lease_expires_at'), ...OWNED].join(', ');
export const TOOL_CALL_COLUMNS = ['run_id', 'id', 'step_id', 'status', 'attempts', 'connection_id', 'server_id', 'tool_name',
  'definition_version', 'arguments_digest', 'requires_approval', ...OWNED].join(', ');
export const APPROVAL_COLUMNS = ['id', 'run_id', 'tool_call_id', 'status', 'connection_id', 'server_id', 'tool_name',
  'definition_version', 'arguments_digest', msColumn('expires_at'), 'arguments', 'tool_snapshot', 'decided_by', 'superseded_by',
  ...OWNED].join(', ');

type Row = Readonly<Record<string, unknown>>;

export function asRow(value: unknown): Row {
  if (typeof value !== 'object' || value === null) throw new Error('Unexpected database row');
  return Object.fromEntries(Object.entries(value));
}

export function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`Unexpected database value: ${key}`);
  return value;
}

/** bigint arrives as a string from pg; anything outside the safe integer range is a fault. */
export function integer(row: Row, key: string): number {
  const value = row[key];
  const parsed = typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed)) throw new Error(`Unexpected database integer: ${key}`);
  return parsed;
}

function optionalInteger(row: Row, key: string): number | undefined {
  return row[key] === null ? undefined : integer(row, key);
}

export function member<T extends string>(row: Row, key: string, values: readonly T[]): T {
  const value = text(row, key);
  const found = values.find(candidate => candidate === value);
  if (found === undefined) throw new Error(`Unexpected database status: ${key}`);
  return found;
}

/** tenant_key '' is the tenant-less sentinel and maps back to an absent tenantId. */
export function ownerColumns(scope: TrustedScope): readonly [string, string, string] {
  const owner = ownerFromScope(scope);
  return [owner.actorId, owner.appId, owner.tenantId ?? ''];
}

function owned(row: Row) {
  const tenant = text(row, 'tenant_key');
  const owner: OwnerScope = Object.freeze({
    actorId: parseId('actor', row['actor_id']), appId: parseId('app', row['app_id']),
    ...(tenant === '' ? {} : { tenantId: parseId('tenant', tenant) }),
  });
  return {
    owner, revision: integer(row, 'revision'),
    createdAt: integer(row, 'created_at_ms'), updatedAt: integer(row, 'updated_at_ms'),
  };
}

function toolRef(row: Row) {
  return Object.freeze({
    connectionId: parseId('mcp_connection', row['connection_id']), serverId: parseId('mcp_server', row['server_id']),
    name: text(row, 'tool_name'), definitionVersion: text(row, 'definition_version'),
  });
}

export function conversationRecord(value: unknown): ConversationRecord {
  const row = asRow(value);
  const title = row['title'];
  return Object.freeze({
    id: parseId('conversation', row['id']), ...owned(row), ...(typeof title === 'string' ? { title } : {}),
  });
}

export function runRecord(value: unknown): RunRecord {
  const row = asRow(value);
  const cancelRequestedAt = optionalInteger(row, 'cancel_requested_at_ms');
  return Object.freeze({
    id: parseId('run', row['id']), conversationId: parseId('conversation', row['conversation_id']),
    status: member<RunStatus>(row, 'status', RUN_STATUSES), ...owned(row),
    ...(cancelRequestedAt === undefined ? {} : { cancelRequestedAt }),
  });
}

export function toolCallRecord(value: unknown): ToolCallRecord {
  const row = asRow(value);
  const requiresApproval = row['requires_approval'];
  if (typeof requiresApproval !== 'boolean') throw new Error('Unexpected database value: requires_approval');
  return Object.freeze({
    id: parseId('tool_call', row['id']), runId: parseId('run', row['run_id']), stepId: parseId('step', row['step_id']),
    status: member<ToolCallStatus>(row, 'status', TOOL_CALL_STATUSES), tool: toolRef(row),
    argumentsDigest: parseArgumentsDigest(row['arguments_digest']), requiresApproval,
    attempts: integer(row, 'attempts'), ...owned(row),
  });
}

export function approvalRecord(value: unknown): ApprovalRecord {
  const row = asRow(value);
  return Object.freeze({
    id: parseId('approval', row['id']), status: member<ApprovalStatus>(row, 'status', APPROVAL_STATUSES),
    binding: Object.freeze({
      runId: parseId('run', row['run_id']), toolCallId: parseId('tool_call', row['tool_call_id']),
      tool: toolRef(row), argumentsDigest: parseArgumentsDigest(row['arguments_digest']),
    }),
    expiresAt: integer(row, 'expires_at_ms'), ...owned(row), ...approvalExtras(row),
  });
}

const HINTS = ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'] as const;

/** Strict decode of the stored tool snapshot; unknown or mistyped fields are a fault. */
export function toolSnapshotOf(value: unknown): ApprovalToolSnapshot {
  const input = parseJsonObject(value);
  const text = (key: string) => {
    const field = input[key];
    if (field !== undefined && typeof field !== 'string') throw new Error(`Invalid tool snapshot ${key}`);
    return field === undefined ? {} : { [key]: field };
  };
  const hints = input['annotations'] === undefined ? undefined : parseJsonObject(input['annotations']);
  const annotations = hints === undefined ? {} : {
    annotations: Object.freeze(Object.fromEntries(HINTS.flatMap(key => (typeof hints[key] === 'boolean' ? [[key, hints[key]]] : [])))),
  };
  return Object.freeze({ inputSchema: parseJsonObject(input['inputSchema']), ...text('title'), ...text('description'), ...annotations });
}

/** Snapshot columns; `{}` (rows written before migration 0005) is omitted. */
function approvalExtras(row: Row) {
  const args = parseJsonObject(row['arguments']);
  const snapshot = parseJsonObject(row['tool_snapshot']);
  return {
    ...(snapshot['inputSchema'] === undefined ? {} : { arguments: args, toolSnapshot: toolSnapshotOf(snapshot) }),
    ...(typeof row['decided_by'] === 'string' ? { decidedBy: parseId('actor', row['decided_by']) } : {}),
    ...(typeof row['superseded_by'] === 'string' ? { supersededBy: parseId('approval', row['superseded_by']) } : {}),
  };
}
