import type { RunId } from '../../../contracts/identity/ids.js';
import type { RunEventRecord } from '../../../contracts/state/events.js';
import type { ReplayItem } from '../../../contracts/events/replay.js';
import type { StoredMessage } from '../../../contracts/state/checkpoints.js';
import type { ApprovalRecord, ToolCallRecord } from '../../../contracts/state/records.js';
import { MESSAGE_COLUMNS, storedMessage } from './message-rows.js';
import { APPROVAL_COLUMNS, TOOL_CALL_COLUMNS, approvalRecord, toolCallRecord } from './rows.js';
import type { SqlQueryable } from './sql-client.js';

async function rows<T>(tx: SqlQueryable, table: 'messages' | 'approvals' | 'tool_calls', columns: string,
  runId: RunId, ids: readonly string[], decode: (row: unknown) => T): Promise<readonly T[]> {
  if (ids.length === 0) return [];
  const result = await tx.query(`SELECT ${columns} FROM viper_engine.${table} WHERE run_id = $1 AND id = ANY($2::text[])`, [runId, ids]);
  return result.rows.map(decode);
}

/** Immutable referenced records only; ownership of the run was established in the same snapshot. */
export async function replayFacts(tx: SqlQueryable, runId: RunId, events: readonly RunEventRecord[]): Promise<readonly ReplayItem[]> {
  const messageIds = events.flatMap(event => typeof event.payload['messageId'] === 'string' ? [event.payload['messageId']] : []);
  const approvalIds = events.flatMap(event => typeof event.payload['approvalId'] === 'string' ? [event.payload['approvalId']] : []);
  const toolIds = events.flatMap(event => event.toolCallId === undefined ? [] : [event.toolCallId]);
  const messages = await rows(tx, 'messages', MESSAGE_COLUMNS, runId, messageIds, storedMessage);
  const approvals = await rows(tx, 'approvals', APPROVAL_COLUMNS, runId, approvalIds, approvalRecord);
  const tools = await rows(tx, 'tool_calls', TOOL_CALL_COLUMNS, runId, toolIds, toolCallRecord);
  return assembleReplayItems(events, messages, approvals, tools);
}

export function assembleReplayItems(events: readonly RunEventRecord[], messages: readonly StoredMessage[],
  approvals: readonly ApprovalRecord[], tools: readonly ToolCallRecord[]): readonly ReplayItem[] {
  const byMessage = new Map(messages.map(record => [String(record.message.id), record.message]));
  const byApproval = new Map(approvals.map(record => [String(record.id), record]));
  const byTool = new Map(tools.map(record => [String(record.id), record]));
  return events.map(event => {
    const message = byMessage.get(String(event.payload['messageId']));
    const approval = byApproval.get(String(event.payload['approvalId']));
    const tool = byTool.get(String(event.toolCallId));
    return { event, ...(message === undefined ? {} : { message }), ...(approval === undefined ? {} : { approval }),
      ...(tool === undefined ? {} : { tool }) };
  });
}
