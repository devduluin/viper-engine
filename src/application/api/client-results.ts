import type { ApiCall } from '../../contracts/api/control.js';
import { ApiFailure, requireState } from '../../contracts/api/failure.js';
import type { TrustedScope } from '../../contracts/identity/scope.js';
import { parseId } from '../../contracts/identity/ids.js';
import type { JsonObject } from '../../contracts/messages/json.js';
import { processClientTools } from '../streaming/client-tools.js';
import type { ApiOptions } from './options.js';

/** A client tool result larger than this is refused (the page snapshot is bounded much lower by the client). */
const MAX_RESULT_BYTES = 48 * 1024;

/**
 * POST /api/v1/runs/{id}/client-results: the caller's answer to a client_tool.request of its own run.
 * Only the run owner may answer; the waiting run (same process) receives it, else `accepted: false`.
 */
export async function submitClientResult(scope: TrustedScope, call: ApiCall, options: ApiOptions) {
  const runId = parseId('run', call.resourceId);
  const run = await options.database.snapshot(async stores => requireState(await stores.runs.get(scope, runId)));
  const toolCallId = String(call.body['toolCallId']);
  const outcome = call.body['outcome'] === 'success'
    ? { outcome: 'success' as const, data: (call.body['data'] ?? {}) as JsonObject }
    : { outcome: 'error' as const, message: typeof call.body['message'] === 'string' ? call.body['message'] : 'The client could not run the tool.' };
  if (Buffer.byteLength(JSON.stringify(outcome)) > MAX_RESULT_BYTES) throw new ApiFailure('PAYLOAD_TOO_LARGE');
  const accepted = run.status === 'running' && (options.clientTools ?? processClientTools).reply(run.id, toolCallId, outcome);
  return { schemaVersion: 1, accepted };
}
