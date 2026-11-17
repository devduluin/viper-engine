import type { JsonValue, JsonObject } from '../../contracts/messages/json.js';
import { parseJsonObject, readJsonArray } from '../../contracts/messages/json.js';
import { API_SCHEMA_DOCUMENT } from '../../contracts/api/schemas.js';

function relaxed(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(relaxed);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, key === 'additionalProperties' && child === false ? true : relaxed(child)]));
}

/** Client tolerates future optional response fields; request schemas stay closed/unmodified. */
export function futureResponseSchema(): JsonObject {
  const document = parseJsonObject(relaxed(API_SCHEMA_DOCUMENT)); const defs = parseJsonObject(document['$defs']);
  const assistant = parseJsonObject(defs['AssistantMessage']);
  const variants = readJsonArray(assistant['oneOf']).map(parseJsonObject);
  const properties = Object.fromEntries(variants.flatMap(variant => Object.entries(parseJsonObject(variant['properties']))));
  // Same-role variants overlap once extra fields are allowed. Keep every known field typed in both branches.
  const anyOf = variants.map(variant => ({ ...variant, properties: { ...properties, ...parseJsonObject(variant['properties']) } }));
  return { ...document, $defs: { ...defs, AssistantMessage: { anyOf } } };
}
