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
 * Render order is tools -> system -> messages. Breakpoints (3 of the 4 allowed):
 * - the last tool: tools alone stay cached when any system text changes (tools are the largest stable part);
 * - the first system block: hosts put their static prompt first and per-run text (date, model, topics) in later blocks,
 *   which therefore carry no marker and never invalidate the stable prefix;
 * - the top-level automatic breakpoint caches the growing tail (history, tool results).
 * Every marker uses the same TTL, so the "longer TTL first" rule always holds.
 */
export function cachedPrefix(system: readonly string[], tools: readonly BetaTool[], cache: PromptCacheSettings | undefined): CachedPrefix {
  const plain: CachedPrefix = {
    ...(system.length === 0 ? {} : { system: system.join('\n\n') }),
    ...(tools.length === 0 ? {} : { tools: [...tools] }),
  };
  if (cache === undefined) return plain;
  const marker: BetaCacheControlEphemeral = { type: 'ephemeral', ttl: cache.ttl };
  const last = tools.length - 1;
  return {
    ...(tools.length === 0 ? {} : { tools: tools.map((tool, index) => (index === last ? { ...tool, cache_control: marker } : tool)) }),
    ...(system.length === 0 ? {} : { system: system.map((text, index): BetaTextBlockParam =>
      (index === 0 ? { type: 'text', text, cache_control: marker } : { type: 'text', text })) }),
    cache_control: marker,
  };
}
