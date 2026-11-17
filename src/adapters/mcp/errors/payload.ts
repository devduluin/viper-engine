import { parseJsonObject } from '../../../contracts/messages/json.js';
import type { JsonObject, JsonValue } from '../../../contracts/messages/json.js';
import { parseMcpContent } from '../../../contracts/mcp/parse-content.js';
import type { McpContent } from '../../../contracts/mcp/content.js';

const fields: Readonly<Record<string, readonly string[]>> = {
  text: ['type', 'text'], image: ['type', 'mimeType', 'data'], audio: ['type', 'mimeType', 'data'],
  resource_link: ['type', 'uri', 'name', 'title', 'description', 'mimeType'], resource: ['type', 'resource'],
};

function splitFields(input: JsonObject, allowed: readonly string[]): { body: JsonObject; metadata: JsonObject } {
  const entries = Object.entries(input);
  return {
    body: Object.fromEntries(entries.filter(([key]) => allowed.includes(key))),
    metadata: Object.fromEntries(entries.filter(([key]) => !allowed.includes(key))),
  };
}

function projectBlock(value: JsonValue): { content: McpContent; metadata: JsonObject } {
  const input = parseJsonObject(value);
  const kind = input['type'];
  if (typeof kind !== 'string' || !Object.hasOwn(fields, kind)) throw new Error('Unsupported MCP content');
  const { body, metadata } = splitFields(input, fields[kind]!);
  if (kind === 'resource') {
    const resource = splitFields(parseJsonObject(body['resource']), ['uri', 'mimeType', 'text', 'blob']);
    return {
      content: parseMcpContent({ ...body, resource: resource.body }),
      metadata: { ...metadata, ...(Object.keys(resource.metadata).length ? { resource: resource.metadata } : {}) },
    };
  }
  return { content: parseMcpContent(body), metadata };
}

function textObject(content: readonly McpContent[]): JsonObject | undefined {
  const blocks = content.filter(block => block.type === 'text');
  if (blocks.length !== 1) return undefined;
  try {
    return parseJsonObject(JSON.parse(blocks[0]!.text) as unknown);
  } catch {
    return undefined;
  }
}

function privateMetadata(envelope: JsonObject, blocks: readonly { metadata: JsonObject }[], derived: boolean): JsonObject {
  const { metadata } = splitFields(envelope, ['content', 'isError', 'structuredContent']);
  const blockMetadata = blocks.map((block, index) => ({ index, metadata: block.metadata }))
    .filter(block => Object.keys(block.metadata).length > 0);
  return {
    ...(Object.keys(metadata).length ? { envelope: metadata } : {}),
    ...(blockMetadata.length ? { content: blockMetadata } : {}),
    ...(derived ? { normalization: { structuredContentSource: 'json_text' } } : {}),
  };
}

export function projectToolPayload(envelope: JsonObject): {
  readonly content: readonly McpContent[]; readonly structuredContent?: JsonObject; readonly privateMeta?: JsonObject;
} {
  if (!Array.isArray(envelope['content'])) throw new Error('Missing MCP content array');
  const blocks = envelope['content'].map(projectBlock);
  const hasStructured = Object.hasOwn(envelope, 'structuredContent');
  const content = blocks.map(block => block.content);
  const structuredContent = hasStructured ? parseJsonObject(envelope['structuredContent']) : textObject(content);
  const privateMeta = privateMetadata(envelope, blocks, !hasStructured && structuredContent !== undefined);
  return {
    content,
    ...(structuredContent !== undefined ? { structuredContent } : {}),
    ...(Object.keys(privateMeta).length ? { privateMeta: parseJsonObject(privateMeta) } : {}),
  };
}
