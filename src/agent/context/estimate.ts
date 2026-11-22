import type { ContentBlock } from '../../contracts/messages/content.js';
import type { ModelRequest } from '../../contracts/models/gateway.js';
import { estimateTextTokens } from '../../shared/tokens/estimator.js';
import { isMedia, MEDIA_TOKEN_ALLOWANCE } from './media.js';

export interface ContextTextEstimate {
  readonly tokens: number;
  readonly approximate: true;
  readonly hasUnpricedMedia: boolean;
  readonly excludesProviderFraming: true;
}

/** Text/schema preflight; each media block adds a fixed allowance (provider framing still excluded). */
export function estimateContextText(request: ModelRequest): ContextTextEstimate {
  const messages = request.messages.map(message => ({
    ...message, content: message.content.map(textProjection),
  }));
  const text = JSON.stringify({ messages, tools: request.tools, responseSchema: request.responseSchema });
  const text_ = estimateTextTokens(text);
  const media = request.messages.reduce((count, message) => count + message.content.filter(isMedia).length, 0);
  return Object.freeze({
    ...text_, tokens: text_.tokens + media * MEDIA_TOKEN_ALLOWANCE,
    hasUnpricedMedia: media > 0,
    excludesProviderFraming: true,
  });
}

function textProjection(block: ContentBlock) {
  return isMedia(block) ? { type: block.type } : block;
}
