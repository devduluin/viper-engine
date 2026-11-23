import type { RuntimeEvent } from '../../agent/runtime/types.js';
import type { JournalCommand } from '../../contracts/state/journal.js';
import { proposals, dispatchCommands, reportCommands, approvalEvents } from './tool-commands.js';
import type { DurableSession } from './session.js';
import { settlePending } from './recovery.js';
import { withDeadline } from '../../shared/async/deadline.js';
import { steeringConsumption, steeringStopGuard } from './steering.js';

const UNAVAILABLE = { source: 'unavailable', inputTokens: null, outputTokens: null, totalTokens: null } as const;

export async function persistEvent(session: DurableSession, event: RuntimeEvent): Promise<void> {
  await session.guard.refresh();
  const commands = eventCommands(session, event);
  if (event.type === 'run_stopped' && !event.status.startsWith('waiting_')) commands.unshift(...settlePending(session, event.reason === 'cancelled'));
  if (event.type === 'run_stopped') commands.unshift(...steeringStopGuard(session, event.status, event.reason));
  await session.commit(commands);
  if (session.deps.onEvent !== undefined && !session.guard.cancelled) {
    await withDeadline(async () => session.deps.onEvent?.(event), {
      operationName: 'durable observer', timeoutMs: Math.max(0, session.state.deadlineAt - session.deps.clock.now()), signal: session.guard.controller.signal,
    });
    if (event.type !== 'run_stopped') await session.guard.refresh();
  }
}

function eventCommands(session: DurableSession, event: RuntimeEvent): JournalCommand[] {
  switch (event.type) {
    case 'model_call_started': return modelStart(session, event);
    case 'model_call_finished': return modelFinish(session, event);
    case 'message_appended': return message(session, event);
    case 'tool_call_dispatching': return dispatchCommands(session, event.toolCallId);
    case 'tool_call_reported': return toolReport(session, event);
    case 'batch_finished': session.state.phase = 'model'; return [];
    case 'tools_discovered': return discoveryFinished(session, event);
    case 'client_tools_completed': return clientToolsFinished(session, event);
    case 'run_stopped': return finish(session, event);
  }
}

/** Assistant + client tool results in one commit; no MCP proposals (nothing was dispatched through MCP). */
function clientToolsFinished(session: DurableSession, event: Extract<RuntimeEvent, { type: 'client_tools_completed' }>): JournalCommand[] {
  session.state.phase = 'model';
  if (session.state.stepId === undefined) throw new Error('Client tool step has no step');
  return [...session.messages(event.messages), { kind: 'step_finish', input: { runId: session.claim.runId,
    stepId: session.state.stepId, decision: 'tool_calls', at: session.deps.clock.now() } }];
}

function discoveryFinished(session: DurableSession, event: Extract<RuntimeEvent, { type: 'tools_discovered' }>): JournalCommand[] {
  session.state.toolDiscovery = event.state; session.state.phase = 'model';
  if (session.state.stepId === undefined) throw new Error('Discovery has no step');
  return [{ kind: 'step_finish', input: { runId: session.claim.runId, stepId: session.state.stepId,
    decision: 'tool_calls', at: session.deps.clock.now() } }];
}

function modelFinish(session: DurableSession, event: Extract<RuntimeEvent, { type: 'model_call_finished' }>): JournalCommand[] {
  session.state.modelPending = false;
  return [{ kind: 'model_finish', input: { runId: session.claim.runId, at: session.deps.clock.now(), modelCallId: event.modelCallId,
    outcome: event.ok ? 'succeeded' : 'failed', usage: event.usage, ...(event.ok ? {} : { failureCode: event.failureCode ?? 'unknown', ...(event.failureDetail ? { failureDetail: event.failureDetail } : {}) }) } }];
}

function toolReport(session: DurableSession, event: Extract<RuntimeEvent, { type: 'tool_call_reported' }>): JournalCommand[] {
  session.report(event.report);
  if (event.message !== undefined) session.state.phase = 'correction';
  return [...reportCommands(session, event.report), ...session.messages(event.message === undefined ? [] : [event.message])];
}

function modelStart(session: DurableSession, event: Extract<RuntimeEvent, { type: 'model_call_started' }>): JournalCommand[] {
  if (event.contextCheckpoint !== undefined) session.state.contextCheckpoint = event.contextCheckpoint;
  session.state.stepIndex += 1; session.state.stepId = event.stepId; session.state.modelCallId = event.modelCallId; session.state.modelPending = true;
  const at = session.deps.clock.now(); const runId = session.claim.runId;
  return [{ kind: 'step_start', input: { runId, stepId: event.stepId, stepIndex: session.state.stepIndex, at,
    events: [session.event('step.started', { index: session.state.stepIndex })] } },
    { kind: 'model_start', input: { runId, stepId: event.stepId, modelCallId: event.modelCallId,
      at, provider: session.deps.provider, model: session.state.model, attempt: 1 } }];
}

function message(session: DurableSession, event: Extract<RuntimeEvent, { type: 'message_appended' }>): JournalCommand[] {
  const commands = [...steeringConsumption(session, event.message), ...session.messages([event.message])];
  if (event.decision === undefined) return commands;
  session.state.phase = event.decision === 'tool_calls' ? 'calls' : event.decision === 'needs_input' ? 'input' : 'final';
  if (session.state.stepId === undefined) throw new Error('Assistant decision has no step');
  commands.push({ kind: 'step_finish', input: { runId: session.claim.runId, stepId: session.state.stepId,
    decision: event.decision, at: session.deps.clock.now() } });
  if (event.message.role === 'assistant') commands.push(...proposals(session, event.message.toolCalls ?? []));
  return commands;
}

function finish(session: DurableSession, event: Extract<RuntimeEvent, { type: 'run_stopped' }>): JournalCommand[] {
  const commands: JournalCommand[] = [];
  if (session.state.modelPending && session.state.modelCallId !== undefined) {
    session.state.modelPending = false;
    commands.push({ kind: 'model_finish', input: { runId: session.claim.runId, modelCallId: session.state.modelCallId,
      at: session.deps.clock.now(), outcome: event.reason === 'cancelled' ? 'cancelled' : 'failed', usage: UNAVAILABLE,
      ...(event.reason === 'cancelled' ? {} : { failureCode: 'timeout' }) } });
  }
  const type = event.status.startsWith('waiting_') ? (event.status === 'waiting_for_input' ? 'run.input_required' : 'approval.required')
    : `run.${event.status}` as 'run.completed' | 'run.partial' | 'run.failed' | 'run.cancelled';
  const last = [...session.checkpoint.history].reverse().find(message => message.role === 'assistant');
  const payload = { reason: event.reason,
    ...(last === undefined ? {} : { messageId: last.id }) };
  commands.push({ kind: 'run_transition', input: { to: event.status, expectedRevision: session.checkpoint.run.revision,
    at: session.deps.clock.now(), events: event.status === 'waiting_for_approval' ? approvalEvents(session) : [session.event(type, payload)] } });
  return commands;
}
