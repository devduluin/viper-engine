/** Project canonical JSON v1: sorted UTF-16 keys, JSON number/string encoding, no coercions. */
function encodeString(value: string): string {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0xD800 || code > 0xDFFF) continue;
    const next = value.charCodeAt(index + 1);
    if (code > 0xDBFF || next < 0xDC00 || next > 0xDFFF || Number.isNaN(next)) throw new Error('Invalid Unicode scalar sequence');
    index++;
  }
  return JSON.stringify(value);
}

function readData(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
    throw new Error('Canonical JSON requires enumerable data properties');
  }
  return descriptor.value;
}

function encodeArray(value: unknown[], ancestors: Set<object>, depth: number): string {
  if (Object.getPrototypeOf(value) !== Array.prototype) throw new Error('Canonical JSON requires plain arrays');
  if (Object.getOwnPropertyNames(value).length !== value.length + 1) throw new Error('Unexpected array properties');
  const items: string[] = [];
  for (let index = 0; index < value.length; index++) items.push(encode(readData(value, String(index)), ancestors, depth + 1));
  return `[${items.join(',')}]`;
}

function encodeObject(value: object, ancestors: Set<object>, depth: number): string {
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error('Canonical JSON requires plain objects');
  const entries = Object.getOwnPropertyNames(value).sort().map(key =>
    `${encodeString(key)}:${encode(readData(value, key), ancestors, depth + 1)}`);
  return `{${entries.join(',')}}`;
}

function encodeContainer(value: object, ancestors: Set<object>, depth: number): string {
  if (ancestors.has(value)) throw new Error('Cyclic canonical JSON');
  if (Object.getOwnPropertySymbols(value).length > 0) throw new Error('Symbol properties are not canonical JSON');
  ancestors.add(value);
  try {
    return Array.isArray(value) ? encodeArray(value, ancestors, depth) : encodeObject(value, ancestors, depth);
  } finally {
    ancestors.delete(value);
  }
}

function encode(value: unknown, ancestors: Set<object>, depth: number): string {
  if (depth > 32) throw new Error('Canonical JSON nesting exceeds 32 levels');
  if (typeof value === 'string') return encodeString(value);
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value === 'object' && value !== null) return encodeContainer(value, ancestors, depth);
  throw new Error('Unsupported canonical JSON value');
}

export function canonicalJson(value: unknown): string {
  return encode(value, new Set(), 0);
}
