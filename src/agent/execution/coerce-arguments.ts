import type { JsonObject, JsonValue } from '../../contracts/messages/json.js';

/**
 * Repairs the most common model slip: a correct value sent as a string ("29332", "true", "[\"a\"]") where the tool
 * schema asks for a number, boolean, array or object. Only the declared shape of the schema is followed (properties,
 * items); union schemas (anyOf/oneOf/allOf) are left alone, and the caller keeps the result only when it then validates.
 */
export function coerceArguments(schema: JsonObject, args: JsonObject): JsonObject {
  const value = coerce(schema, args, 0);
  return isObject(value) ? value : args;
}

const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const MAX_DEPTH = 8;

function types(schema: JsonObject): readonly string[] {
  const type = schema['type'];
  return typeof type === 'string' ? [type] : Array.isArray(type) ? type.filter((item): item is string => typeof item === 'string') : [];
}

function coerce(schema: unknown, value: JsonValue, depth: number): JsonValue {
  if (!isObject(schema) || depth > MAX_DEPTH) return value;
  const wanted = types(schema);
  const parsed = typeof value === 'string' ? fromString(value, wanted) : value;
  if (isObject(parsed)) return coerceObject(schema, parsed, depth);
  if (Array.isArray(parsed)) return coerceArray(schema, parsed, depth);
  return parsed;
}

function fromString(text: string, wanted: readonly string[]): JsonValue {
  if (wanted.includes('string')) return text;
  const trimmed = text.trim();
  return toNumber(trimmed, wanted) ?? toBoolean(trimmed, wanted) ?? toJson(trimmed, wanted) ?? text;
}

function toNumber(text: string, wanted: readonly string[]): number | undefined {
  const integer = wanted.includes('integer'); const number = wanted.includes('number');
  if ((!integer && !number) || !NUMBER.test(text)) return undefined;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return undefined;
  return number || Number.isSafeInteger(parsed) ? parsed : undefined;
}

function toBoolean(text: string, wanted: readonly string[]): boolean | undefined {
  return wanted.includes('boolean') && (text === 'true' || text === 'false') ? text === 'true' : undefined;
}

function toJson(text: string, wanted: readonly string[]): JsonValue | undefined {
  if ((!wanted.includes('array') && !wanted.includes('object')) || !/^[[{]/.test(text)) return undefined;
  try {
    const json = JSON.parse(text) as JsonValue;
    return (Array.isArray(json) && wanted.includes('array')) || (isObject(json) && wanted.includes('object')) ? json : undefined;
  } catch { return undefined; } // not JSON: the validator rejects the original string
}

function coerceObject(schema: JsonObject, value: JsonObject, depth: number): JsonObject {
  const properties = schema['properties'];
  if (!isObject(properties)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, coerce(properties[key], item, depth + 1)]));
}

function coerceArray(schema: JsonObject, value: readonly JsonValue[], depth: number): JsonValue[] {
  const items = schema['items'];
  return isObject(items) ? value.map(item => coerce(items, item, depth + 1)) : [...value];
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
