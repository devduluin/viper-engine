import type { Message } from '../../contracts/messages/message.js';
import type { DiscoveryExchange } from '../../contracts/discovery/state.js';
import { parseMessageHistory } from '../../contracts/messages/history.js';

/** Projection only: discovery exchanges never become canonical history, facts, grants or MCP calls. */
export function withDiscoveryExchanges(messages: readonly Message[], exchanges: readonly DiscoveryExchange[] = []): readonly Message[] {
  const projected = messages.flatMap(message => [message, ...exchanges.filter(item => item.afterMessageId === message.id)
    .flatMap(item => [item.assistant, item.result])]);
  return parseMessageHistory(projected, { allowPendingToolCalls: false });
}
