import type { JsonObject } from '../../contracts/messages/json.js';
import type { TrustedScope } from '../../contracts/identity/scope.js';
import { ApiFailure } from '../../contracts/api/failure.js';
import { withDeadline } from '../../shared/async/deadline.js';
import type { ApiOptions } from './options.js';
import { userMessage } from './input.js';

/** Reference media needs an owner-aware host grant before it can be forwarded to a provider. */
export async function authorizedUserMessage(scope: TrustedScope, body: JsonObject, options: ApiOptions) {
  const message = userMessage(body, options.ids);
  for (const block of message.content) {
    if ((block.type !== 'image' && block.type !== 'audio') || block.source.kind !== 'reference') continue;
    const source = block.source; const authorize = options.authorizeMedia;
    if (authorize === undefined) throw new ApiFailure('ACCESS_DENIED');
    const allowed = await withDeadline(() => authorize(scope, source), { operationName: 'media authorization', timeoutMs: 10000 });
    if (!allowed) throw new ApiFailure('ACCESS_DENIED');
  }
  return message;
}
