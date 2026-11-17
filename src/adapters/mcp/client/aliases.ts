import type { McpToolDefinition } from '../../../contracts/mcp/catalog.js';
import { mcpToolKey } from '../../../contracts/mcp/identity.js';
import { createFingerprint } from '../../../shared/fingerprints/fingerprint.js';

/** Provider-safe function name (the strictest common rule across model APIs). */
export const MODEL_ALIAS_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const PREFIX_PATTERN = /^[a-z][a-z0-9]{0,15}$/;

export interface AliasedTool {
  readonly alias: string;
  readonly definition: McpToolDefinition;
}

function shortHash(definition: McpToolDefinition): string {
  // Hash of the server-side name only, so a definition change keeps the same alias.
  return createFingerprint({ name: definition.ref.name, server: definition.ref.serverId },
    { domain: 'viper.mcp.tool_alias', version: '1' }).slice(0, 8);
}

function aliasOf(prefix: string, definition: McpToolDefinition): string {
  const sanitized = definition.ref.name.replace(/[^A-Za-z0-9_-]/g, '_');
  const alias = `${prefix}__${sanitized}`;
  const exact = sanitized === definition.ref.name && alias.length <= 64;
  return exact ? alias : `${alias.slice(0, 64 - 9)}_${shortHash(definition)}`;
}

/**
 * Stable model-facing names `<prefix>__<tool>`. Names that need sanitizing or truncation get a
 * hash suffix, so different server names never collapse into one alias. The runtime maps the
 * alias back to the exact `McpToolRef`; the alias itself grants nothing.
 */
export function namespaceTools(prefix: string, definitions: readonly McpToolDefinition[]): readonly AliasedTool[] {
  if (!PREFIX_PATTERN.test(prefix)) throw new Error('Alias prefix must be 1-16 lowercase letters/digits, starting with a letter');
  const seen = new Map<string, string>();
  const tools = definitions.map(definition => {
    const alias = aliasOf(prefix, definition);
    if (!MODEL_ALIAS_PATTERN.test(alias)) throw new Error('Generated alias is not provider-safe');
    const key = mcpToolKey(definition.ref);
    const previous = seen.get(alias);
    if (previous !== undefined && previous !== key) throw new Error(`Alias collision for ${alias}`);
    seen.set(alias, key);
    return Object.freeze({ alias, definition });
  });
  return Object.freeze(tools);
}
