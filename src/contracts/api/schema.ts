/** Portable JSON Schema 2020-12 data; validators/frameworks stay outside contracts. */
export type Schema = Readonly<Record<string, unknown>>;

export const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
export const id: Schema = { type: 'string', minLength: 1, maxLength: 256, pattern: '^[^\\s\\p{Cc}\\p{Cf}]+$' };
export const revision: Schema = { type: 'integer', minimum: 1, maximum: MAX_SAFE_INTEGER };
export const sequence: Schema = { type: 'integer', minimum: 0, maximum: MAX_SAFE_INTEGER };
export const instant: Schema = { type: 'integer', minimum: 0, maximum: 8_640_000_000_000_000 };
export const digest: Schema = { type: 'string', pattern: '^[0-9a-f]{64}$' };
export const cursor: Schema = { type: 'string', minLength: 1, maxLength: 2048, pattern: '^[A-Za-z0-9_-]+$' };
export const key: Schema = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[!-~]+$' };
export const text: Schema = { type: 'string', minLength: 1, maxLength: 65_536, pattern: '\\S' };
export const uri: Schema = { type: 'string', minLength: 1, maxLength: 2048, pattern: '^[A-Za-z][A-Za-z0-9+.-]*:' };

export function ref(name: string): Schema { return { $ref: `#/$defs/${name}` }; }
export function literal(value: string | number): Schema { return { const: value }; }
export function array(items: Schema, maxItems = 100, minItems = 0): Schema {
  return { type: 'array', items, minItems, maxItems };
}
export function object(properties: Readonly<Record<string, Schema>>, required = Object.keys(properties)): Schema {
  return { type: 'object', properties, required, additionalProperties: false };
}
