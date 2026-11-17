import type { BetaCacheControlEphemeral, BetaTextBlockParam, BetaTool } from '@anthropic-ai/sdk/resources/beta/messages/messages';

/** Prompt caching (X02). Absent = off: the request is byte-identical to the uncached form. */
export interface PromptCacheSettings {
  /** 5m for agent loops (calls well under 5 minutes apart); 1h only when measured gaps justify the 2x write. */
  readonly ttl: '5m' | '1h';
}

export interface CachedPrefix {
  readonly system?: string | BetaTextBlockParam[];
  readonly tools?: BetaTool[];
  readonly cache_control?: BetaCacheControlEphemeral;
}

/**
 * Render order is tools -> system -> messages. One explicit breakpoint closes the stable prefix
 * (last system block, or the last tool when there is no system text): tools + system are written once
 * and read by every later call. The top-level automatic breakpoint then caches the growing tail
 * (history, tool results). Both use the same TTL, so the "longer TTL first" rule always holds.
 */
export function cachedPrefix(system: readonly string[], tools: readonly BetaTool[], cache: PromptCacheSettings | undefined): CachedPrefix {
  const plain: CachedPrefix = {
    ...(system.length === 0 ? {} : { system: system.join('\n\n') }),
    ...(tools.length === 0 ? {} : { tools: [...tools] }),
  };
  if (cache === undefined) return plain;
  const marker: BetaCacheControlEphemeral = { type: 'ephemeral', ttl: cache.ttl };
  if (system.length > 0) {
    return { ...plain, system: [{ type: 'text', text: system.join('\n\n'), cache_control: marker }], cache_control: marker };
  }
  if (tools.length > 0) {
    const last = tools.length - 1;
    return { tools: tools.map((tool, index) => (index === last ? { ...tool, cache_control: marker } : tool)), cache_control: marker };
  }
  return { cache_control: marker };
}
