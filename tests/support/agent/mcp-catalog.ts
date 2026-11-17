import { parseJsonObject } from '../../../src/contracts/messages/json.js';
import type { JsonObject, JsonValue } from '../../../src/contracts/messages/json.js';
import type { McpConnectionRef } from '../../../src/contracts/mcp/identity.js';
import type {
  McpPromptDefinition, McpResourceDefinition, McpToolDefinition,
} from '../../../src/contracts/mcp/catalog.js';

export const FIXTURE_TOOL_VERSION = 'fixture-v1';

export function fixtureItems(value: unknown, key: string): readonly JsonObject[] {
  const items = parseJsonObject(value)[key];
  if (!Array.isArray(items)) throw new Error(`Missing fixture list: ${key}`);
  return items.map(parseJsonObject);
}

export function fixtureString(value: JsonValue | undefined): string {
  if (typeof value !== 'string') throw new Error('Invalid fixture string');
  return value;
}

export function fixtureTool(item: JsonObject, connection: McpConnectionRef): McpToolDefinition {
  return Object.freeze({
    ref: Object.freeze({
      connectionId: connection.id, serverId: connection.serverId,
      name: fixtureString(item['name']), definitionVersion: FIXTURE_TOOL_VERSION,
    }),
    inputSchema: parseJsonObject(item['inputSchema']),
    ...(item['description'] === undefined ? {} : { description: fixtureString(item['description']) }),
    ...(item['outputSchema'] === undefined ? {} : { outputSchema: parseJsonObject(item['outputSchema']) }),
  });
}

export function fixtureResource(item: JsonObject): McpResourceDefinition {
  return Object.freeze({
    uri: fixtureString(item['uri']), name: fixtureString(item['name']),
    ...(item['mimeType'] === undefined ? {} : { mimeType: fixtureString(item['mimeType']) }),
  });
}

export function fixturePrompt(item: JsonObject): McpPromptDefinition {
  return Object.freeze({
    name: fixtureString(item['name']),
    ...(item['description'] === undefined ? {} : { description: fixtureString(item['description']) }),
  });
}
