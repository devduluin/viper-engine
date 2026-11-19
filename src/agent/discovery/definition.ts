import type { ModelToolDefinition } from '../../contracts/models/gateway.js';
import { TOOL_SEARCH_NAME } from '../../contracts/discovery/state.js';

export function searchDefinition(sources: readonly { readonly source: string; readonly count: number }[]): ModelToolDefinition {
  return Object.freeze({ name: TOOL_SEARCH_NAME,
    description: `Discover authorized MCP tools. Call this alone, before using an unloaded tool. Matching schemas become callable next turn. Search names/descriptions/parameters; retry alternate wording (including English) after no matches. Sources: ${JSON.stringify(sources)}. Discovery grants no execution permission.`,
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      query: { type: 'string', minLength: 1, maxLength: 512 }, source: { type: 'string', maxLength: 128 },
    }, required: ['query'] },
  });
}
