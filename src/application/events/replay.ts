import type { EventReplay, EventReplayStore, ReplayBatch, ReplayPage } from '../../contracts/events/replay.js';
import type { ApiCursorPort } from '../../contracts/api/control.js';
import type { TrustedScope } from '../../contracts/identity/scope.js';
import type { RunId } from '../../contracts/identity/ids.js';
import type { JsonObject } from '../../contracts/messages/json.js';
import { ApiFailure } from '../../contracts/api/failure.js';
import { isTerminalRunStatus } from '../../contracts/state/run-state.js';
import { eventPayload } from './payload.js';

export class ReplayEvents implements EventReplay {
  constructor(private readonly store: EventReplayStore, private readonly cursors: ApiCursorPort, private readonly batchSize: number) {}

  async open(scope: TrustedScope, runId: RunId, cursor?: string): Promise<ReplayBatch> {
    await this.load(scope, runId, undefined); // Ownership before cursor expiry/state disclosure.
    const value = cursor === undefined ? '0' : this.cursors.read(scope, 'event', runId, cursor);
    if (!/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value))) throw new ApiFailure('INVALID_CURSOR');
    return this.next(scope, runId, Number(value));
  }

  async next(scope: TrustedScope, runId: RunId, after: number): Promise<ReplayBatch> {
    return this.project(scope, await this.load(scope, runId, after), after);
  }

  private async load(scope: TrustedScope, runId: RunId, after: number | undefined): Promise<ReplayPage> {
    try { return await this.store.read(scope, runId, after, this.batchSize); }
    catch (error) {
      if (error instanceof ApiFailure) throw error;
      throw new ApiFailure('CONNECTION_UNAVAILABLE', { action: 'retry_later', retryAfterMs: 1000 });
    }
  }

  private project(scope: TrustedScope, page: ReplayPage, after: number): ReplayBatch {
    try {
      const events = page.items.map(item => {
        const e = item.event;
        const event: JsonObject = { schemaVersion: 1, eventId: e.eventId, sequence: e.sequence,
          conversationId: e.conversationId, runId: e.runId, occurredAt: e.occurredAt, type: e.type, payload: eventPayload(item),
          ...(e.stepId === undefined ? {} : { stepId: e.stepId }), ...(e.modelCallId === undefined ? {} : { modelCallId: e.modelCallId }),
          ...(e.toolCallId === undefined ? {} : { toolCallId: e.toolCallId }) };
        return { cursor: this.cursors.issue(scope, 'event', page.run.id, String(e.sequence)), event };
      });
      return { events, after: page.items.at(-1)?.event.sequence ?? after, highWater: page.lastEventSequence,
        terminal: isTerminalRunStatus(page.run.status) };
    } catch { throw new ApiFailure('EVENT_CURSOR_EXPIRED', { runId: page.run.id, action: 'fetch_snapshot' }); }
  }
}
