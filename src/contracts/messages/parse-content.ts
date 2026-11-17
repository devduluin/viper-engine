import type { ContentBlock, MediaSource } from './content.js';
import { parseJsonValue } from './json.js';
import { array, exactKeys, nonEmptyString, record } from './validation.js';

function parseMediaSource(input: unknown): MediaSource {
  const source = record(input, 'media source');
  const mediaType = nonEmptyString(source['mediaType'], 'media type');
  if (source['kind'] === 'reference') {
    exactKeys(source, ['kind', 'mediaType', 'uri']);
    return Object.freeze({ kind: 'reference', mediaType, uri: nonEmptyString(source['uri'], 'media reference') });
  }
  exactKeys(source, ['kind', 'mediaType', 'encoding', 'data']);
  if (source['kind'] !== 'inline' || source['encoding'] !== 'base64') throw new Error('Invalid inline media encoding');
  const data = nonEmptyString(source['data'], 'media data');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
    throw new Error('Invalid base64 media data');
  }
  return Object.freeze({ kind: 'inline', mediaType, encoding: 'base64', data });
}

export function parseContentBlock(input: unknown): ContentBlock {
  const block = record(input, 'content block');
  if (block['type'] === 'text') {
    exactKeys(block, ['type', 'text']);
    if (typeof block['text'] !== 'string') throw new Error('Invalid text content');
    return Object.freeze({ type: 'text', text: block['text'] });
  }
  if (block['type'] === 'json') {
    exactKeys(block, ['type', 'data']);
    return Object.freeze({ type: 'json', data: parseJsonValue(block['data']) });
  }
  if (block['type'] === 'image' || block['type'] === 'audio') {
    exactKeys(block, ['type', 'source']);
    return Object.freeze({ type: block['type'], source: parseMediaSource(block['source']) });
  }
  throw new Error('Unsupported content block');
}

export function parseContent(input: unknown): readonly ContentBlock[] {
  return Object.freeze(array(input, 'content blocks').map(parseContentBlock));
}
