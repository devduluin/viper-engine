import { resolveToolDiscovery } from '../contracts/discovery/config.js';
import type { ToolDiscoveryConfig } from '../contracts/discovery/config.js';

/** Explicit injected environment only. Library factories never read process.env. */
export function parseToolDiscoveryConfig(env: Readonly<Record<string, string | undefined>>): ToolDiscoveryConfig {
  const keys = { mode: 'VIPER_TOOL_DISCOVERY_MODE', eagerMaxCount: 'VIPER_TOOL_EAGER_MAX_COUNT',
    eagerMaxTokens: 'VIPER_TOOL_EAGER_MAX_TOKENS', searchTopK: 'VIPER_TOOL_SEARCH_TOP_K',
    activeMaxTokens: 'VIPER_TOOL_ACTIVE_MAX_TOKENS', maxSearchCalls: 'VIPER_TOOL_SEARCH_MAX_CALLS',
    catalogMaxTools: 'VIPER_TOOL_CATALOG_MAX_TOOLS' };
  const values: Record<string, string | number | string[]> = {};
  for (const [key, name] of Object.entries(keys)) {
    const raw = env[name]?.trim(); if (raw === undefined || raw === '') continue;
    if (key === 'mode') values[key] = raw;
    else { if (!/^\d+$/.test(raw)) throw new Error(`Invalid ${name}`); values[key] = Number(raw); }
  }
  const pinned = env['VIPER_TOOL_PINNED']?.split(',').map(name => name.trim()).filter(name => name !== '');
  return resolveToolDiscovery(pinned === undefined || pinned.length === 0 ? values : { ...values, pinned });
}
