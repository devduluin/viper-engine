import type { EngineClient, RunSnapshotView, ApprovalView, ClientUpdate, StartRunView, SubmitInputView } from '../src/index.js';

export interface HeadlessTask {
  readonly input: StartRunView; readonly idempotencyKey: string; readonly signal?: AbortSignal;
  readonly onUpdate: (update: ClientUpdate) => Promise<void>;
  /** Trusted host/user decisions. Absence leaves the task paused and returns its snapshot. */
  readonly decide?: (approval: ApprovalView) => Promise<'accept' | 'reject' | undefined>;
  readonly answer?: (snapshot: RunSnapshotView) => Promise<Pick<SubmitInputView, 'inputId' | 'input'> | undefined>;
}

/** Minimal reusable flow. The host supplies authentication, persistence of events and human interaction. */
export async function runHeadlessTask(client: EngineClient, task: HeadlessTask): Promise<RunSnapshotView> {
  const read = task.signal === undefined ? {} : { signal: task.signal };
  await client.capabilities(read);
  const conversation = await client.createConversation({}, read);
  const run = await client.startRun(conversation.conversationId, task.input, task.idempotencyKey, read);
  let latest: RunSnapshotView | undefined;
  for await (const update of client.watch(run.runId, read)) {
    await task.onUpdate(update);
    if (update.kind === 'snapshot') latest = update.snapshot;
    else if (['approval.required', 'run.input_required'].includes(update.event.type)) latest = await client.run(run.runId, read);
    else continue;
    if (!await respond(client, latest, task)) return latest;
  }
  if (latest === undefined) throw new Error('No run snapshot');
  return latest;
}

async function respond(client: EngineClient, snapshot: RunSnapshotView, task: HeadlessTask): Promise<boolean> {
  const read = task.signal === undefined ? {} : { signal: task.signal };
  if (snapshot.status === 'waiting_for_approval') {
    for (const approval of snapshot.pendingApprovals ?? []) {
      const decision = await task.decide?.(approval); if (decision === undefined) return false;
      await client.decideApproval(approval.approvalId, { expectedRevision: approval.revision, proposal: approval.proposal, decision }, read);
    }
  }
  if (snapshot.status === 'waiting_for_input') {
    const answer = await task.answer?.(snapshot); if (answer === undefined) return false;
    await client.submitInput(snapshot.runId, { ...answer, expectedRevision: snapshot.revision }, read);
  }
  return true;
}
