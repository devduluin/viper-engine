import type { ApiCall } from '../../contracts/api/control.js';
import type { TrustedScope } from '../../contracts/identity/scope.js';
import { parseId } from '../../contracts/identity/ids.js';
import { ApiFailure, requireState } from '../../contracts/api/failure.js';
import type { ApiOptions } from './options.js';
import { approvalView, publicMessage, runView } from './projection.js';
import type { JsonObject } from '../../contracts/messages/json.js';

export async function conversation(scope: TrustedScope, call: ApiCall, options: ApiOptions) {
  const id = parseId('conversation', call.resourceId);
  return options.database.snapshot(async stores => {
    const record = requireState(await stores.conversations.get(scope, id));
    const after = call.cursor === undefined ? 0 : Number(options.cursors.read(scope, 'messages', id, call.cursor));
    if (!Number.isSafeInteger(after) || after < 0) throw new ApiFailure('INVALID_CURSOR');
    const limit = call.limit ?? 100;
    const page = requireState(await stores.messages.read(scope, id, after, limit + 1));
    const rows = page.messages.slice(0, limit); const last = rows.at(-1);
    const activeRun = await stores.control.getActiveRun?.(id);
    return { schemaVersion: 1, conversationId: record.id, revision: record.revision, createdAt: record.createdAt,
      updatedAt: record.updatedAt, ...(record.title === undefined ? {} : { title: record.title }),
      ...(activeRun ? { activeRun } : {}),
      messages: rows.filter(row => row.message.role !== 'system').map(row => publicMessage(row.message)),
      ...(page.messages.length <= limit || last === undefined ? {} : {
        nextCursor: options.cursors.issue(scope, 'messages', id, String(last.position)) }) };
  });
}

export async function getRun(scope: TrustedScope, call: ApiCall, options: ApiOptions) {
  return options.database.snapshot(async stores => runView(scope,
    requireState(await stores.checkpoints.load(scope, parseId('run', call.resourceId))), options.cursors));
}

/** Sub-agents of a run and their open approvals: the parent's conversation shows and decides them (PLAN-SUBAGENTS §6.3). */
export async function listRunAgents(scope: TrustedScope, call: ApiCall, options: ApiOptions) {
  return options.database.snapshot(async stores => {
    const parent = requireState(await stores.checkpoints.load(scope, parseId('run', call.resourceId)));
    const agents: JsonObject[] = [];
    for (const child of await stores.agents.children(scope, parent.run.id)) {
      const cp = requireState(await stores.checkpoints.load(scope, child.runId));
      agents.push({ runId: child.runId, key: child.spawnKey, profile: child.profile, status: child.status,
        pendingApprovals: cp.approvals.filter(approval => approval.status === 'pending').map(approvalView) });
    }
    return { schemaVersion: 1, runId: parent.run.id, agents };
  });
}

export async function cancelRun(scope: TrustedScope, call: ApiCall, options: ApiOptions) {
  return options.database.transaction(async stores => {
    const run = requireState(await stores.runs.requestCancellation(scope, parseId('run', call.resourceId), options.clock.now(), []));
    return runView(scope, requireState(await stores.checkpoints.load(scope, run.id)), options.cursors);
  });
}
