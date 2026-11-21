import type { JsonObject } from '../../contracts/messages/json.js';

export function searchArguments(args: JsonObject): { query: string; alternatives: readonly string[]; source?: string } | undefined {
  const query = args['query']; const source = args['source'];
  if (Object.keys(args).some(key => !['query', 'source', 'alternatives'].includes(key))) return undefined;
  if (typeof query !== 'string' || query.trim().length < 1 || query.length > 512) return undefined;
  if (source !== undefined && (typeof source !== 'string' || source.length > 128)) return undefined;
  const alternatives = alternateQueries(args['alternatives']);
  if (alternatives === undefined) return undefined;
  return { query, alternatives, ...(source === undefined ? {} : { source }) };
}

function alternateQueries(raw: unknown): readonly string[] | undefined {
  const values = raw ?? [];
  return Array.isArray(values) && values.length <= 2 && values.every(validAlternative) ? values as string[] : undefined;
}

function validAlternative(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
}
