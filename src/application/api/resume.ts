import { parseId } from '../../contracts/identity/ids.js';
import type { TrustedScope } from '../../contracts/identity/scope.js';
import type { ApiCall } from '../../contracts/api/control.js';
import { ApiFailure, requireState } from '../../contracts/api/failure.js';
import { checkExpectedRevision } from '../../contracts/state/result.js';
import { checkApprovalBinding, parseArgumentsDigest } from '../../contracts/state/approval-state.js';
import { parseJsonObject } from '../../contracts/messages/json.js';
import { createFingerprint } from '../../shared/fingerprints/fingerprint.js';
import type { ApiOptions } from './options.js';
import { accepted, approvalView } from './projection.js';
import { revision, text } from './input.js';
import { authorizedUserMessage } from './user-input.js';

export async function submitInput(scope: TrustedScope, call: ApiCall, options: ApiOptions) {
  const runId = parseId('run', call.resourceId); const inputId = text(call.body, 'inputId');
  const fingerprint = createFingerprint(call.body, { domain: 'api.run.input', version: '1' });
  return options.database.transaction(async stores => {
    const run = requireState(await stores.control.lockRun(scope, runId));
    const receipt = await stores.control.inputReceipt(scope, runId, inputId);
    if (receipt !== undefined) {
      if (receipt.fingerprint !== fingerprint) throw new ApiFailure('IDEMPOTENCY_CONFLICT');
      return receipt.response;
    }
    const conflict = checkExpectedRevision(run.revision, revision(call.body));
    if (conflict !== undefined) requireState({ ok: false, error: conflict });
    if (run.status !== 'waiting_for_input' || run.cancelRequestedAt !== undefined) throw new ApiFailure('INVALID_STATE');
    const conversation = requireState(await stores.control.lockConversation(scope, run.conversationId));
    const input = await authorizedUserMessage(scope, call.body, options);
    requireState(await stores.messages.append(scope, run.conversationId, { expectedRevision: conversation.revision,
      at: options.clock.now(), messages: [input] }));
    const resumed = requireState(await stores.runs.wake(scope, runId, { expectedRevision: run.revision, at: options.clock.now(), events: [] }));
    const response = accepted(resumed);
    await stores.control.saveInputReceipt(scope, runId, inputId, fingerprint, response);
    return response;
  });
}

export async function decideApproval(scope: TrustedScope, call: ApiCall, options: ApiOptions) {
  const id = parseId('approval', call.resourceId);
  return options.database.transaction(async stores => {
    const located = requireState(await stores.approvals.get(scope, id));
    const run = requireState(await stores.control.lockRun(scope, located.binding.runId));
    const before = requireState(await stores.approvals.get(scope, id));
    const conflict = checkExpectedRevision(before.revision, revision(call.body));
    if (conflict !== undefined) requireState({ ok: false, error: conflict });
    const binding = parseJsonObject(call.body['proposal']); const tool = parseJsonObject(binding['tool']);
    const mismatch = checkApprovalBinding(before.binding, {
      runId: parseId('run', binding['runId']), toolCallId: parseId('tool_call', binding['toolCallId']),
      argumentsDigest: parseArgumentsDigest(binding['argumentsDigest']), tool: {
        connectionId: parseId('mcp_connection', tool['connectionId']), serverId: parseId('mcp_server', tool['serverId']),
        name: text(tool, 'name'), definitionVersion: text(tool, 'definitionVersion') },
    });
    if (mismatch !== undefined) requireState({ ok: false, error: mismatch });
    if (run.status !== 'waiting_for_approval' || run.cancelRequestedAt !== undefined) throw new ApiFailure('INVALID_STATE');
    const decision = text(call.body, 'decision');
    const result = requireState(await stores.approvals.decide(scope, id, { expectedRevision: revision(call.body),
      to: decision === 'accept' ? 'accepted' : 'rejected', at: options.clock.now(), events: [] }));
    // Multiple proposals may be decided in any order. Wake only when none still await a decision.
    const cp = requireState(await stores.checkpoints.load(scope, run.id));
    if (!cp.approvals.some(approval => approval.status === 'pending' && approval.expiresAt > options.clock.now())) {
      requireState(await stores.runs.wake(scope, run.id, { expectedRevision: run.revision, at: options.clock.now(), events: [] }));
    }
    return approvalView(result);
  });
}
