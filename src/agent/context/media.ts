import type { ContentBlock } from '../../contracts/messages/content.js';
import type { Message } from '../../contracts/messages/message.js';

/**
 * Media in the model's view of the conversation (canonical history is never edited). Images from tools (screenshots)
 * and users reach the model natively, but only the most recent ones: every image is re-sent on every step, so older
 * ones become a short text note. A model that cannot take a block type gets the same note instead of the whole
 * conversation failing. Budgets count each media block as a fixed allowance instead of its base64 size.
 */
export const MAX_INLINE_MEDIA = 2;
/** Conservative per-image estimate (a ~1.1 MP screenshot is ~1,500 tokens on current providers). */
export const MEDIA_TOKEN_ALLOWANCE = 1600;
export const MEDIA_BYTE_ALLOWANCE = 4096;
/** Hard ceiling per inline block (base64 characters); larger media is never sent (provider per-image maximum). */
export const MAX_MEDIA_BYTES = 5 * 1024 * 1024;

export function isMedia(block: ContentBlock): block is Extract<ContentBlock, { type: 'image' | 'audio' }> {
  return block.type === 'image' || block.type === 'audio';
}

const NOTES = {
  older: `omitted from context: only the ${MAX_INLINE_MEDIA} most recent are re-sent. Capture it again if you need to see it.`,
  unsupported: 'omitted: the current model does not accept this input. Use the text description in this result.',
  oversize: 'omitted: larger than the per-image limit. Capture a smaller region (selector, no fullPage).',
} as const;

function note(block: ContentBlock, reason: keyof typeof NOTES): ContentBlock {
  return { type: 'text', text: `[${block.type === 'audio' ? 'Audio' : 'Image'} ${NOTES[reason]}]` };
}

const oversize = (block: Extract<ContentBlock, { type: 'image' | 'audio' }>) => block.source.kind === 'inline' && block.source.data.length > MAX_MEDIA_BYTES;

/** Keeps the newest MAX_INLINE_MEDIA supported media blocks inline; replaces the rest with notes. */
export function projectMedia(messages: readonly Message[], contentTypes: readonly ContentBlock['type'][]): readonly Message[] {
  let inline = 0;
  const projected = [...messages].reverse().map(message => {
    if (!message.content.some(isMedia)) return message;
    const content = [...message.content].reverse().map(block => {
      if (!isMedia(block)) return block;
      if (!contentTypes.includes(block.type)) return note(block, 'unsupported');
      if (oversize(block)) return note(block, 'oversize');
      return ++inline <= MAX_INLINE_MEDIA ? block : note(block, 'older');
    }).reverse();
    return { ...message, content } as Message;
  });
  return Object.freeze(projected.reverse());
}

/** Request size with each media block counted as MEDIA_BYTE_ALLOWANCE (provider image limits are separate). */
export function measuredBytes(value: unknown): number {
  let media = 0;
  const text = JSON.stringify(value, (_key, item: unknown) => {
    if (item !== null && typeof item === 'object' && 'type' in item && (item.type === 'image' || item.type === 'audio') && 'source' in item) {
      media++; return { type: item.type };
    }
    return item;
  });
  return new TextEncoder().encode(text).byteLength + media * MEDIA_BYTE_ALLOWANCE;
}
