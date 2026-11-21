import { searchCatalog } from './search.js';
import type { SearchDocument } from './search.js';

/** Model supplies equivalent wording; reciprocal-rank fusion needs no additional model/index call. */
export function searchAlternatives(documents: readonly SearchDocument[], query: string,
  alternatives: readonly string[], source: string | undefined, limit: number): SearchDocument[] {
  const queries = [...new Set([query, ...alternatives].map(value => value.trim().toLowerCase()))];
  if (queries.length === 1) return searchCatalog(documents, query, source, limit);
  const scores = new Map<SearchDocument, number>();
  for (const wording of queries) {
    const matches = searchCatalog(documents, wording, source, limit);
    for (const [rank, document] of matches.entries()) scores.set(document, (scores.get(document) ?? 0) + 1 / (60 + rank + 1));
  }
  return [...scores].sort(([left, a], [right, b]) => b - a
    || (left.tool.name < right.tool.name ? -1 : left.tool.name > right.tool.name ? 1 : 0))
    .slice(0, limit).map(([document]) => document);
}
