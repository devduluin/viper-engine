import { parseId } from '../../contracts/identity/ids.js';
import type { TrustedScope } from '../../contracts/identity/scope.js';
import type { ApiCall } from '../../contracts/api/control.js';
import { ApiFailure, requireState } from '../../contracts/api/failure.js';
import { MAX_PENDING_STEERING, STEERABLE_RUN_STATUSES } from '../../contracts/state/steering.js';
import type { SteeringMessage } from '../../contracts/state/steering.js';
import type { RunRecord } from '../../contracts/state/records.js';
import { createFingerprint } from '../../shared/fingerprints/fingerprint.js';
import type { ApiOptions } from './options.js';
import { accepted } from './projection.js';
import { text } from './input.js';
import { authorizedUserMessage } from './user-input.js';

function steerable(run: RunRecord): boolean {
  return (STEERABLE_RUN_STATUSES as readonly string[]).includes(run.status) && run.cancelRequestedAt === undefined;
}

/**
 * Mid-run user message. Queued under the run row lock (the same lock every journal stop takes), so a run
 * either concludes first (INVALID_STATE: the client sends a new run) or sees this message before it may
 * complete. Never appends to the conversation: the run's lease holder does, at a step boundary.
 * `inputId` deduplicates retries; the response names the message the run will append.
 */
export async function steerRun(scope: TrustedScope, call: ApiCall, options: ApiOptions) {
  const runId = parseId('run', call.resourceId); const inputId = text(call.body, 'inputId');
  const fingerprint = createFingerprint(call.body, { domain: 'api.run.steer', version: '1' });
  return options.database.transaction(async stores => {
    const run = requireState(await stores.control.lockRun(scope, runId));
    const receipt = await stores.control.inputReceipt(scope, runId, inputId);
    if (receipt !== undefined) {
      if (receipt.fingerprint !== fingerprint) throw new ApiFailure('IDEMPOTENCY_CONFLICT');
      return receipt.response;
    }
    if (!steerable(run)) throw new ApiFailure('INVALID_STATE');
    if (await stores.control.pendingSteering(runId) >= MAX_PENDING_STEERING) throw new ApiFailure('RATE_LIMITED');
    const message = await authorizedUserMessage(scope, call.body, options) as SteeringMessage;
    await stores.control.queueSteering(scope, runId, { inputId, message, at: options.clock.now() });
    const response = { ...accepted(run), messageId: message.id };
    await stores.control.saveInputReceipt(scope, runId, inputId, fingerprint, response);
    return response;
  });
}
