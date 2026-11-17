export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;
export interface JsonObject { readonly [key: string]: JsonValue }

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertNoSymbols(value: object): void {
  if (Object.getOwnPropertySymbols(value).length > 0) throw new Error('JSON symbol properties are not allowed');
}

function dataProperty(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new Error('JSON accessors or sparse entries are not allowed');
  if (!descriptor.enumerable) throw new Error('Non-enumerable JSON data is not allowed');
  return descriptor.value;
}

export function readJsonRecord(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new Error('Expected plain JSON object');
  assertNoSymbols(value);
  for (const key of Object.getOwnPropertyNames(value)) dataProperty(value, key);
  return value;
}

export function readJsonArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new Error('Expected plain JSON array');
  assertNoSymbols(value);
  if (Object.getOwnPropertyNames(value).length !== value.length + 1) throw new Error('Unexpected JSON array properties');
  const items: unknown[] = [];
  for (let index = 0; index < value.length; index++) items.push(dataProperty(value, String(index)));
  return Object.freeze(items);
}

function cloneRecord(value: Record<string, unknown>, ancestors: Set<object>, depth: number): JsonObject {
  assertNoSymbols(value);
  const entries = Object.getOwnPropertyNames(value).map(key =>
    [key, cloneJson(dataProperty(value, key), ancestors, depth + 1)] as const);
  return Object.freeze(Object.fromEntries(entries));
}

function cloneArray(value: readonly unknown[], ancestors: Set<object>, depth: number): readonly JsonValue[] {
  return Object.freeze(readJsonArray(value).map(item => cloneJson(item, ancestors, depth + 1)));
}

function cloneContainer(value: object, ancestors: Set<object>, depth: number): JsonValue {
  if (ancestors.has(value)) throw new Error('Cyclic JSON value');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return cloneArray(value, ancestors, depth);
    return cloneRecord(readJsonRecord(value), ancestors, depth);
  } finally {
    ancestors.delete(value);
  }
}

function cloneJson(value: unknown, ancestors: Set<object>, depth: number): JsonValue {
  if (depth > 32) throw new Error('JSON nesting exceeds 32 levels');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'object' && value !== null) return cloneContainer(value, ancestors, depth);
  throw new Error('Expected JSON-compatible value');
}

/** Plain JSON data only: no accessors, symbols, hidden fields, array subclasses or iterators. */
export function parseJsonValue(value: unknown): JsonValue {
  return cloneJson(value, new Set(), 0);
}

export function parseJsonObject(value: unknown): JsonObject {
  const object = readJsonRecord(value);
  return cloneRecord(object, new Set([object]), 0);
}
