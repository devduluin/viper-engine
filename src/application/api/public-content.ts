import type { ContentBlock } from '../../contracts/messages/content.js';
import { parseJsonObject } from '../../contracts/messages/json.js';
import type { JsonObject } from '../../contracts/messages/json.js';

function textBlocks(text: string): JsonObject[] {
  if (text.length === 0) return [{ type: 'text', text }];
  const blocks: JsonObject[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(text.length, start + 65536);
    const previous = text.charCodeAt(end - 1);
    if (end < text.length && previous >= 0xD800 && previous <= 0xDBFF) end -= 1;
    blocks.push({ type: 'text', text: text.slice(start, end) }); start = end;
  }
  return blocks;
}

/** Fit v1 wire bounds while retaining all evidence; never silently drop overflowing blocks. */
export function publicContent(content: readonly ContentBlock[]): readonly JsonObject[] {
  const blocks = content.flatMap(block => block.type === 'text' ? textBlocks(block.text) : [parseJsonObject(block)]);
  if (blocks.length <= 32) return blocks;
  return [...blocks.slice(0, 31), { type: 'json', data: { type: 'content_overflow', blocks: blocks.slice(31) } }];
}
