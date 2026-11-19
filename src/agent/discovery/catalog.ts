import type { TrustedScope } from '../../contracts/identity/scope.js';
import { mcpToolKey } from '../../contracts/mcp/identity.js';
import type { RuntimeTool } from '../execution/tool-catalog.js';
import { indexTools } from '../execution/tool-catalog.js';
import { estimateTextTokens } from '../../shared/tokens/estimator.js';
import { searchDocument } from './search.js';
import { TOOL_SEARCH_NAME } from '../../contracts/discovery/state.js';

export const schemaTokens = (value: unknown) => estimateTextTokens(JSON.stringify(value)).tokens;
export function discoveryCatalog(tools: readonly RuntimeTool[], scope: TrustedScope, maximum: number) {
  if (tools.length > maximum || new TextEncoder().encode(JSON.stringify(tools)).byteLength > 8388608) throw new RangeError('Discovery catalog limit exceeded');
  const index = indexTools(tools, scope);
  if (index.find(TOOL_SEARCH_NAME) !== undefined) throw new Error('Reserved discovery alias collision');
  const documents = index.modelTools.map(tool => searchDocument(tool, tool.name.includes('__')
    ? tool.name.split('__')[0]! : index.find(tool.name)!.context.connection.id));
  const counts = new Map<string, number>();
  for (const item of documents) counts.set(item.source, (counts.get(item.source) ?? 0) + 1);
  if (counts.size > 32) throw new RangeError('Discovery source limit exceeded');
  return { index, documents, sources: [...counts].map(([source, count]) => ({ source, count })),
    key: (alias: string) => { const tool = index.find(alias); return tool === undefined ? undefined : mcpToolKey(tool.definition.ref); } };
}
