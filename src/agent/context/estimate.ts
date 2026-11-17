import type { ContentBlock } from '../../contracts/messages/content.js';
import type { ModelRequest } from '../../contracts/models/gateway.js';
import { estimateTextTokens } from '../../shared/tokens/estimator.js';

export interface ContextTextEstimate {
  readonly tokens: number;
  readonly approximate: true;
  readonly hasUnpricedMedia: boolean;
  readonly excludesProviderFraming: true;
}

/** Text/schema preflight only. Media pricing and provider framing require a provider adapter. */
export function estimateContextText(request: ModelRequest): ContextTextEstimate {
  const messages = request.messages.map(message => ({
    ...message, content: message.content.map(textProjection),
  }));
  const text = JSON.stringify({ messages, tools: request.tools, responseSchema: request.responseSchema });
  return Object.freeze({
    ...estimateTextTokens(text),
    hasUnpricedMedia: request.messages.some(message => message.content.some(isMedia)),
    excludesProviderFraming: true,
  });
}

function isMedia(block: ContentBlock): boolean {
  return block.type === 'image' || block.type === 'audio';
}

function textProjection(block: ContentBlock) {
  return isMedia(block) ? { type: block.type } : block;
}
