import type { ApiCall, ApiStores } from '../../contracts/api/control.js';
import type { TrustedScope } from '../../contracts/identity/scope.js';
import { parseId } from '../../contracts/identity/ids.js';
import { parseJsonObject } from '../../contracts/messages/json.js';
import { parseMessage } from '../../contracts/messages/parse-message.js';
import { ApiFailure, requireState } from '../../contracts/api/failure.js';
import { createFingerprint } from '../../shared/fingerprints/fingerprint.js';
import { withDeadline } from '../../shared/async/deadline.js';
import type { ApiOptions } from './options.js';
import { accepted } from './projection.js';
import { RUN_EFFORTS, type RunEffort } from '../../contracts/state/ports.js';
import type { JsonObject } from '../../contracts/messages/json.js';
import { authorizedUserMessage } from './user-input.js';

export async function startRun(scope: TrustedScope, call: ApiCall, options: ApiOptions) {
  const id = parseId('conversation', call.resourceId);
  if (call.key === undefined || !/^[!-~]{1,128}$/.test(call.key)) throw new ApiFailure('INVALID_REQUEST');
  const key = createFingerprint({ resource: id, key: call.key }, { domain: 'api.runs.key', version: '1' });
  const fingerprint = createFingerprint({ method: 'POST', resource: id, body: call.body }, { domain: 'api.runs.body', version: '1' });
  const queuedModel = await options.queuedModel?.(scope);
  return options.database.transaction(async stores => {
    requireState(await stores.conversations.get(scope, id));
    const request = { operation: 'runs.create', key, fingerprint };
    const begun = requireState(await stores.idempotency.begin(scope, { ...request, at: options.clock.now(),
      ttlMs: options.idempotencyRetentionSeconds * 1000 }));
    if (begun.status === 'replay') return accepted(requireState(await stores.runs.get(scope, parseId('run', begun.resourceRef))));
    if (begun.status === 'in_progress') throw new ApiFailure('INVALID_STATE', { action: 'retry_later' });
    const conversation = requireState(await stores.control.lockConversation(scope, id));
    if (await stores.control.hasActiveRun(id)) throw new ApiFailure('INVALID_STATE');
    const instructions = await prepareContext(scope, call, options, stores);
    const input = await authorizedUserMessage(scope, call.body, options);
    const at = options.clock.now(); const runId = options.ids.next('run');
    const effort = runEffort(call.body); const clientTools = runClientTools(call.body);
    const payload = { ...(queuedModel ? { queuedModel } : {}), ...runDelegation(call.body) };
    const run = requireState(await stores.runs.create(scope, { id: runId, conversationId: id, at, ...(effort ? { effort } : {}),
      ...(clientTools.length > 0 ? { clientTools } : {}),
      events: [{ eventId: options.ids.next('run_event'), type: 'run.queued', occurredAt: at, payload }] }));
    requireState(await stores.messages.append(scope, id, { expectedRevision: conversation.revision, at, runId,
      messages: [input] }));
    await stores.control.saveInstructions(scope, runId, instructions);
    requireState(await stores.idempotency.complete(scope, { ...request, claimId: begun.claimId, resourceRef: runId }));
    return accepted(run);
  });
}

function runDelegation(body: JsonObject): JsonObject {
  const options = parseJsonObject(body['options'] ?? {});
  const delegation = options['delegation'];
  return delegation === 'off' || delegation === 'auto' ? { delegation } : {};
}

/** `options.effort` (schema-validated): the user's speed/depth choice for this run. */
function runEffort(body: JsonObject): RunEffort | undefined {
  const options = body['options'];
  const value = options !== null && typeof options === 'object' && !Array.isArray(options) ? (options as JsonObject)['effort'] : undefined;
  return RUN_EFFORTS.find(effort => effort === value);
}

/** `options.clientTools` (schema-validated names); the host offers only the ones it implements. */
function runClientTools(body: JsonObject): readonly string[] {
  const options = body['options'];
  const value = options !== null && typeof options === 'object' && !Array.isArray(options) ? (options as JsonObject)['clientTools'] : undefined;
  return Array.isArray(value) ? value.filter((name): name is string => typeof name === 'string') : [];
}

async function prepareContext(scope: TrustedScope, call: ApiCall, options: ApiOptions, stores: ApiStores) {
  const selection = parseJsonObject(call.body['context'] ?? {});
  if (Object.values(selection).every(value => Array.isArray(value) && value.length === 0)) return [];
  if (options.prepareContext === undefined) throw new ApiFailure('INVALID_REQUEST');
  await authorizeSelections(scope, selection, stores);
  const messages = await withDeadline(() => options.prepareContext!(scope, selection), { operationName: 'API context preparation', timeoutMs: 10000 });
  return messages.map(message => {
    const parsed = parseMessage(message);
    if (parsed.role !== 'system') throw new ApiFailure('INVALID_REQUEST');
    return parsed;
  });
}

async function authorizeSelections(scope: TrustedScope, selection: import('../../contracts/messages/json.js').JsonObject, stores: ApiStores) {
  const resources = Array.isArray(selection['resources']) ? selection['resources'] : [];
  const prompts = Array.isArray(selection['prompts']) ? selection['prompts'] : [];
  for (const entry of [...resources, ...prompts]) {
    const selected = parseJsonObject(entry);
    const record = requireState(await stores.connections.get(scope, parseId('mcp_connection', selected['connectionId'])));
    if (record.authState === 'authentication_required') throw new ApiFailure('AUTHENTICATION_REQUIRED');
    if (record.authState === 'revoked') throw new ApiFailure('ACCESS_DENIED');
    if (!record.server.enabled) throw new ApiFailure('CONNECTION_UNAVAILABLE');
  }
}
