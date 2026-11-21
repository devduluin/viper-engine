import type { ModelToolDefinition } from '../../contracts/models/gateway.js';
import { TOOL_SEARCH_NAME } from '../../contracts/discovery/state.js';

export function searchDefinition(sources: readonly { readonly source: string; readonly count: number }[]): ModelToolDefinition {
  return Object.freeze({ name: TOOL_SEARCH_NAME,
    description: `Discover authorized MCP tools. Call this alone, before using an unloaded tool. Matching schemas become callable next turn. Search names/descriptions/parameters. For conceptual or multilingual questions, supply up to two concise alternative queries using equivalent English terms or likely parameter names in the SAME call. Do not invent tools or permissions. Sources: ${JSON.stringify(sources)}. Discovery grants no execution permission.`,
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      query: { type: 'string', minLength: 1, maxLength: 512 }, source: { type: 'string', maxLength: 128 },
      alternatives: { type: 'array', maxItems: 2, items: { type: 'string', minLength: 1, maxLength: 256 } },
    }, required: ['query'] },
  });
}
