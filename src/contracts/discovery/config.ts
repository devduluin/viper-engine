import { parseJsonObject } from '../messages/json.js';

export interface ToolDiscoveryConfig {
  readonly mode: 'auto' | 'on' | 'off';
  readonly eagerMaxCount: number; readonly eagerMaxTokens: number;
  readonly searchTopK: number; readonly activeMaxTokens: number; readonly maxSearchCalls: number;
  readonly catalogMaxTools: number;
}
export const DEFAULT_TOOL_DISCOVERY: ToolDiscoveryConfig = Object.freeze({ mode: 'auto', eagerMaxCount: 30,
  eagerMaxTokens: 6000, searchTopK: 5, activeMaxTokens: 8000, maxSearchCalls: 8, catalogMaxTools: 10000 });
const BOUNDS = { eagerMaxCount: 1000, eagerMaxTokens: 100000, searchTopK: 20,
  activeMaxTokens: 100000, maxSearchCalls: 32, catalogMaxTools: 10000 } as const;

export function resolveToolDiscovery(input: unknown = {}): ToolDiscoveryConfig {
  const values = parseJsonObject(input);
  if (Object.keys(values).some(key => !Object.hasOwn(DEFAULT_TOOL_DISCOVERY, key))) throw new Error('Unknown tool discovery setting');
  const mode = values['mode'] ?? DEFAULT_TOOL_DISCOVERY.mode;
  if (mode !== 'auto' && mode !== 'on' && mode !== 'off') throw new Error('Invalid tool discovery mode');
  const integer = (key: keyof typeof BOUNDS) => {
    const value = values[key] ?? DEFAULT_TOOL_DISCOVERY[key]; const maximum = BOUNDS[key];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum) throw new RangeError(`Invalid discovery ${key}`);
    return value;
  };
  return Object.freeze({ mode, eagerMaxCount: integer('eagerMaxCount'), eagerMaxTokens: integer('eagerMaxTokens'),
    searchTopK: integer('searchTopK'), activeMaxTokens: integer('activeMaxTokens'), maxSearchCalls: integer('maxSearchCalls'),
    catalogMaxTools: integer('catalogMaxTools') });
}
