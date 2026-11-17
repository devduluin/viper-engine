import type { TrustedScope } from '../identity/scope.js';
import type { RunId } from '../identity/ids.js';
import type { RunEventRecord } from '../state/events.js';
import type { RunRecord, ApprovalRecord, ToolCallRecord } from '../state/records.js';
import type { Message } from '../messages/message.js';
import type { JsonObject } from '../messages/json.js';

export interface ReplayItem {
  readonly event: RunEventRecord;
  readonly message?: Message; readonly approval?: ApprovalRecord; readonly tool?: ToolCallRecord;
}
export interface ReplayPage {
  readonly run: RunRecord; readonly lastEventSequence: number; readonly items: readonly ReplayItem[];
}
export interface EventReplayStore {
  read(scope: TrustedScope, runId: RunId, after: number | undefined, limit: number): Promise<ReplayPage>;
}
export interface ReplayBatch {
  readonly after: number; readonly highWater: number; readonly terminal: boolean;
  readonly events: readonly { readonly cursor: string; readonly event: JsonObject }[];
}
export interface EventReplay {
  open(scope: TrustedScope, runId: RunId, cursor?: string): Promise<ReplayBatch>;
  next(scope: TrustedScope, runId: RunId, after: number): Promise<ReplayBatch>;
}
