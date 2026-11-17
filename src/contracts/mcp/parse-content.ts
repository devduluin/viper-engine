import { parseJsonObject } from '../messages/json.js';
import { parseContentBlock } from '../messages/parse-content.js';
import type { McpContent, McpResourceContents } from './content.js';
import { assertMcpFields, mcpString, optionalMcpStrings } from './validation.js';

export function parseMcpResourceContents(value: unknown): McpResourceContents {
  const input = parseJsonObject(value);
  assertMcpFields(input, ['uri', 'mimeType', 'text', 'blob']);
  const uri = mcpString(input, 'uri');
  const metadata = optionalMcpStrings(input, ['mimeType']);
  const hasText = Object.hasOwn(input, 'text');
  if (hasText === Object.hasOwn(input, 'blob')) throw new Error('Resource needs exactly one text or blob body');
  if (hasText) return Object.freeze({ uri, ...metadata, text: mcpString(input, 'text', true) });
  const blob = mcpString(input, 'blob', true);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(blob)) throw new Error('Invalid resource base64 blob');
  return Object.freeze({ uri, ...metadata, blob });
}

export function parseMcpContent(value: unknown): McpContent {
  const input = parseJsonObject(value);
  if (input['type'] === 'text') {
    assertMcpFields(input, ['type', 'text']);
    return Object.freeze({ type: 'text', text: mcpString(input, 'text', true) });
  }
  if (input['type'] === 'resource') {
    assertMcpFields(input, ['type', 'resource']);
    return Object.freeze({ type: 'resource', resource: parseMcpResourceContents(input['resource']) });
  }
  if (input['type'] === 'resource_link') {
    assertMcpFields(input, ['type', 'uri', 'name', 'title', 'description', 'mimeType']);
    return Object.freeze({
      type: 'resource_link', uri: mcpString(input, 'uri'), name: mcpString(input, 'name'),
      ...optionalMcpStrings(input, ['title', 'description', 'mimeType']),
    });
  }
  assertMcpFields(input, ['type', 'mimeType', 'data']);
  if (input['type'] !== 'image' && input['type'] !== 'audio') throw new Error('Unsupported MCP content type');
  const type = input['type'];
  const mimeType = mcpString(input, 'mimeType');
  const data = mcpString(input, 'data');
  parseContentBlock({ type, source: { kind: 'inline', mediaType: mimeType, encoding: 'base64', data } });
  return Object.freeze({ type, mimeType, data });
}

export function parseMcpContents(value: unknown): readonly McpContent[] {
  const snapshot = parseJsonObject({ content: value });
  if (!Array.isArray(snapshot['content'])) throw new Error('Expected MCP content array');
  return Object.freeze(snapshot['content'].map(parseMcpContent));
}
