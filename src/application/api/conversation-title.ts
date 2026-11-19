import type { ApiCall } from '../../contracts/api/control.js';
import { ApiFailure, requireState } from '../../contracts/api/failure.js';
import type { TrustedScope } from '../../contracts/identity/scope.js';
import { parseId } from '../../contracts/identity/ids.js';
import type { Message } from '../../contracts/messages/message.js';
import { withDeadline } from '../../shared/async/deadline.js';
import type { ApiOptions } from './options.js';

const MAX_TITLE = 60;

/**
 * POST /api/v1/conversations/{id}/title. With `title`: the user's rename. Without: a short title generated
 * by the host from the first question and answer (the model call happens outside any transaction).
 */
export async function titleConversation(scope: TrustedScope, call: ApiCall, options: ApiOptions) {
  const id = parseId('conversation', call.resourceId);
  const given = typeof call.body['title'] === 'string' ? cleanTitle(call.body['title'], 200) : undefined;
  const title = given ?? await generatedTitle(scope, id, options);
  if (title === '') throw new ApiFailure('INVALID_REQUEST');
  return options.database.transaction(stores => stores.control.setConversationTitle(scope, id, title));
}

async function generatedTitle(scope: TrustedScope, id: ReturnType<typeof parseId<'conversation'>>, options: ApiOptions): Promise<string> {
  if (options.titleConversation === undefined) throw new ApiFailure('INVALID_REQUEST');
  const page = await options.database.snapshot(async stores => {
    requireState(await stores.conversations.get(scope, id));
    return requireState(await stores.messages.read(scope, id, 0, 20));
  });
  const messages = page.messages.map(row => row.message);
  const question = firstText(messages, 'user'); const answer = firstText(messages, 'assistant');
  if (question === '') throw new ApiFailure('INVALID_STATE');
  const raw = await withDeadline(() => options.titleConversation!(scope, { question, answer }),
    { operationName: 'conversation title', timeoutMs: 15000 })
    .catch(() => { throw new ApiFailure('CONNECTION_UNAVAILABLE', { action: 'retry_later', retryAfterMs: 2000 }); });
  return cleanTitle(raw, MAX_TITLE);
}

function firstText(messages: readonly Message[], role: 'user' | 'assistant'): string {
  for (const message of messages) {
    if (message.role !== role) continue;
    const text = message.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join(' ').trim();
    if (text !== '') return text.slice(0, 2000);
  }
  return '';
}

/** One line, no wrapping quotes or trailing period, bounded. */
export function cleanTitle(value: string, max: number): string {
  const line = value.replace(/\s+/g, ' ').trim().replace(/^["'“”‘’`*#\s]+|["'“”‘’`*\s]+$/g, '').replace(/[.。]+$/, '').trim();
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
}
