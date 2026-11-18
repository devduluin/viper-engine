import type { ApiCall, ConversationPosition } from '../../contracts/api/control.js';
import { ApiFailure } from '../../contracts/api/failure.js';
import type { TrustedScope } from '../../contracts/identity/scope.js';
import type { ApiOptions } from './options.js';

const RESOURCE = 'conversations';

/** Keyset page over the caller's conversations (newest activity first). Cursors are signed and owner-bound. */
export async function listConversations(scope: TrustedScope, call: ApiCall, options: ApiOptions) {
  const after = call.cursor === undefined ? undefined : position(options.cursors.read(scope, 'conversations', RESOURCE, call.cursor));
  const limit = call.limit ?? 50;
  return options.database.snapshot(async stores => {
    const all = await stores.control.listConversations(scope, after, limit + 1); const items = all.slice(0, limit);
    const last = items.at(-1); const id = last?.['conversationId']; const updatedAt = last?.['updatedAt'];
    return { schemaVersion: 1, items, ...(all.length <= limit || typeof id !== 'string' || typeof updatedAt !== 'number' ? {} : {
      nextCursor: options.cursors.issue(scope, 'conversations', RESOURCE, `${updatedAt}:${id}`) }) };
  });
}

function position(value: string): ConversationPosition {
  const split = value.indexOf(':'); const updatedAt = Number(value.slice(0, split));
  if (split <= 0 || !Number.isSafeInteger(updatedAt)) throw new ApiFailure('INVALID_REQUEST');
  return { updatedAt, id: value.slice(split + 1) };
}
