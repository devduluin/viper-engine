import type { JsonObject } from '../messages/json.js';

export function assertMcpFields(input: JsonObject, fields: readonly string[]): void {
  if (Object.keys(input).some(key => !fields.includes(key))) throw new Error('Unexpected normalized MCP field');
}

export function mcpString(input: JsonObject, key: string, allowEmpty = false): string {
  const value = input[key];
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)) throw new Error(`Invalid MCP ${key}`);
  return value;
}

export function optionalMcpStrings(input: JsonObject, keys: readonly string[]): Readonly<Record<string, string>> {
  const entries = keys.filter(key => Object.hasOwn(input, key)).map(key => [
    key, mcpString(input, key, ['title', 'description'].includes(key)),
  ]);
  return Object.freeze(Object.fromEntries(entries));
}
