import type { JsonObject } from '../../contracts/messages/json.js';

export function searchArguments(args: JsonObject): { query: string; source?: string } | undefined {
  const query = args['query']; const source = args['source'];
  if (Object.keys(args).some(key => key !== 'query' && key !== 'source')) return undefined;
  if (typeof query !== 'string' || query.trim().length < 1 || query.length > 512) return undefined;
  if (source !== undefined && (typeof source !== 'string' || source.length > 128)) return undefined;
  return { query, ...(source === undefined ? {} : { source }) };
}
