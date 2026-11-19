import type { ModelToolDefinition } from '../../contracts/models/gateway.js';

function terms(text: string): string[] {
  const words = text.replace(/([a-z])([A-Z])/g, '$1 $2').normalize('NFKD').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.map(word => word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word).slice(0, 4096);
}
export interface SearchDocument { readonly tool: ModelToolDefinition; readonly source: string; readonly words: ReadonlyMap<string, number>; readonly length: number }
export function searchDocument(tool: ModelToolDefinition, source: string): SearchDocument {
  const tokens = terms(`${tool.name} ${tool.description ?? ''} ${JSON.stringify(tool.inputSchema)}`); const words = new Map<string, number>();
  for (const token of tokens) words.set(token, (words.get(token) ?? 0) + 1);
  return { tool, source, words, length: tokens.length };
}
/** BM25 over the already authorized in-memory catalog; no external index, model or credential access. */
export function searchCatalog(documents: readonly SearchDocument[], query: string, source: string | undefined, limit: number) {
  const candidates = documents.filter(item => source === undefined || item.source === source);
  const queryTerms = [...new Set(terms(query))].slice(0, 32);
  const average = candidates.reduce((sum, item) => sum + item.length, 0) / Math.max(1, candidates.length);
  const frequencies = new Map(queryTerms.map(term => [term, candidates.filter(item => item.words.has(term)).length]));
  return candidates.map(item => ({ item, score: queryTerms.reduce((total, term) => {
    const frequency = item.words.get(term) ?? 0;
    const inverse = Math.log(1 + (candidates.length - (frequencies.get(term) ?? 0) + 0.5) / ((frequencies.get(term) ?? 0) + 0.5));
    return total + inverse * frequency * 2.2 / (frequency + 1.2 * (0.25 + 0.75 * item.length / Math.max(1, average)));
  }, 0) })).filter(hit => hit.score > 0).sort((a, b) => b.score - a.score || compare(a.item.tool.name, b.item.tool.name)).slice(0, limit).map(hit => hit.item);
}
function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
