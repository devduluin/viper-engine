import type { Message, ToolCall } from '../../contracts/messages/message.js';
import { parseMessage } from '../../contracts/messages/parse-message.js';
import type { JournalCommand } from '../../contracts/state/journal.js';
import type { DurableSession } from './session.js';
import { transition } from './tool-commands.js';
import { mcpToolKey } from '../../contracts/mcp/identity.js';

/** Only calls without a persisted result can be considered for execution/reconciliation. */
export function pendingCalls(history: readonly Message[]): ToolCall[] {
  const answered = new Set(history.flatMap(message => message.role === 'tool' ? [message.toolCallId] : []));
  return history.flatMap(message => message.role === 'assistant' ? message.toolCalls ?? [] : []).filter(call => !answered.has(call.id));
}

export function pendingFor(session: DurableSession): ToolCall[] {
  const own = new Set(session.checkpoint.runMessageIds);
  const ids = new Set(session.checkpoint.history.flatMap(message => own.has(message.id) && message.role === 'assistant' ? (message.toolCalls ?? []).map(call => call.id) : []));
  return pendingCalls(session.checkpoint.history).filter(call => ids.has(call.id));
}

export function batchReports(session: DurableSession) {
  const message = session.checkpoint.history.filter(message => message.role === 'assistant' && (message.toolCalls?.length ?? 0) > 0).at(-1);
  const ids = new Set(message?.role === 'assistant' ? (message.toolCalls ?? []).map(call => call.id) : []);
  return session.state.reports.filter(report => ids.has(report.id));
}

function resultMessage(session: DurableSession, call: ToolCall, outcome: 'success' | 'error' | 'unknown', text: string): Message {
  return parseMessage({ id: session.deps.ids.next('message'), role: 'tool', toolCallId: call.id, outcome, content: [{ type: 'text', text }] });
}

/** No outcome is guessed: an inherited dispatch intent is unknown, never re-dispatched. */
export function settlePending(session: DurableSession, cancelled: boolean): JournalCommand[] {
  const commands: JournalCommand[] = []; const messages: Message[] = [];
  for (const call of pendingFor(session)) {
    const settled = settleCall(session, call, cancelled);
    commands.push(...settled.commands); messages.push(settled.message);
  }
  commands.push(...session.messages(messages));
  return commands;
}

function settleCall(session: DurableSession, call: ToolCall, cancelled: boolean) {
  const row = session.checkpoint.toolCalls.find(row => row.id === call.id);
  const status = recordedStatus(row?.status);
  const commands = row !== undefined && ['proposed', 'ready', 'awaiting_approval', 'retry_wait', 'dispatching'].includes(row.status)
    ? [transition(row, status === 'unknown' ? 'unknown' : 'cancelled', session.deps.clock.now())] : [];
  session.report({ id: call.id, name: call.name, status });
  const text = status === 'unknown' ? 'Previous dispatch has no confirmed outcome; do not repeat it' : 'Prior call settled without further dispatch';
  return { commands, message: resultMessage(session, call, messageOutcome(status),
    cancelled ? 'Run cancelled; outcome retained without further dispatch' : text) };
}

function recordedStatus(status: string | undefined) {
  if (status === 'dispatching' || status === 'unknown') return 'unknown';
  if (status === 'succeeded') return 'succeeded';
  if (status === 'failed') return 'failed';
  return 'cancelled';
}

function messageOutcome(status: ReturnType<typeof recordedStatus>) {
  return ({ succeeded: 'success', failed: 'error', cancelled: 'error', unknown: 'unknown' } as const)[status];
}

export async function recover(session: DurableSession): Promise<'unknown' | undefined> {
  if (session.state.modelPending && session.state.modelCallId !== undefined) {
    session.state.modelPending = false;
    await session.commit([{ kind: 'model_finish', input: { runId: session.claim.runId, modelCallId: session.state.modelCallId,
      at: session.deps.clock.now(), outcome: 'failed', failureCode: 'unknown',
      usage: { source: 'unavailable', inputTokens: null, outputTokens: null, totalTokens: null } } }]);
  }
  if (session.checkpoint.toolCalls.some(row => row.status === 'dispatching' || row.status === 'unknown')) {
    await session.commit(settlePending(session, false));
    return 'unknown';
  }
  const closed = pendingFor(session).filter(call => session.checkpoint.toolCalls.some(row => row.id === call.id
    && ['succeeded', 'failed', 'rejected', 'cancelled'].includes(row.status)));
  if (closed.length > 0) {
    const messages = closed.map(call => {
      const row = session.checkpoint.toolCalls.find(row => row.id === call.id);
      const status = row?.status === 'succeeded' ? 'succeeded' : row?.status === 'failed' ? 'failed' : 'rejected';
      session.report({ id: call.id, name: call.name, status });
      return resultMessage(session, call, status === 'succeeded' ? 'success' : 'error', 'Stored call is settled or superseded; it is never replayed');
    });
    await session.commit(session.messages(messages));
  }
  return undefined;
}

/** Materialize server-side amendments after the preceding batch is fully answered. */
export async function materializeAmendments(session: DurableSession): Promise<void> {
  const known = new Set(session.checkpoint.history.flatMap(message => message.role === 'assistant' ? (message.toolCalls ?? []).map(call => call.id) : []));
  const calls = session.checkpoint.toolCalls.filter(row => row.status === 'awaiting_approval' && !known.has(row.id)).map(row => {
    const approval = session.checkpoint.approvals.find(approval => approval.binding.toolCallId === row.id);
    const original = session.checkpoint.toolCalls.find(old => known.has(old.id) && old.stepId === row.stepId && mcpToolKey(old.tool) === mcpToolKey(row.tool));
    if (approval?.arguments === undefined || original === undefined) throw new Error('Amended call has no recoverable snapshot');
    const old = session.call(original.id);
    return { id: row.id, name: old.name, arguments: approval.arguments };
  });
  if (calls.length === 0) return;
  session.state.phase = 'calls';
  await session.commit(session.messages([parseMessage({ id: session.deps.ids.next('message'), role: 'assistant', content: [], toolCalls: calls })]));
}
