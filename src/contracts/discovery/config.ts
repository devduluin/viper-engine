import { parseJsonObject } from '../messages/json.js';

export interface ToolDiscoveryConfig {
  readonly mode: 'auto' | 'on' | 'off';
  readonly eagerMaxCount: number; readonly eagerMaxTokens: number;
  readonly searchTopK: number; readonly activeMaxTokens: number; readonly maxSearchCalls: number;
  readonly catalogMaxTools: number;
  /**
   * Core tools always offered and callable from the first step, even while discovery is on. Each entry is an alias
   * (`os__os_info`) or a remote tool name (`os_info`, matching any `<namespace>__os_info`). Authorization is unchanged:
   * only tools in the run's authorized catalog can match.
   */
  readonly pinned: readonly string[];
}
export const DEFAULT_TOOL_DISCOVERY: ToolDiscoveryConfig = Object.freeze({ mode: 'auto', eagerMaxCount: 30,
  eagerMaxTokens: 6000, searchTopK: 5, activeMaxTokens: 8000, maxSearchCalls: 8, catalogMaxTools: 10000, pinned: Object.freeze([]) });
const PINNED_MAX = 64;
const PINNED_NAME = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

function pinnedTools(value: unknown): readonly string[] {
  if (value === undefined) return DEFAULT_TOOL_DISCOVERY.pinned;
  if (!Array.isArray(value) || value.length > PINNED_MAX) throw new RangeError('Invalid discovery pinned');
  if (value.some(name => typeof name !== 'string' || !PINNED_NAME.test(name))) throw new Error('Invalid discovery pinned tool name');
  return Object.freeze([...new Set(value as string[])]);
}
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
    catalogMaxTools: integer('catalogMaxTools'), pinned: pinnedTools(values['pinned']) });
}
