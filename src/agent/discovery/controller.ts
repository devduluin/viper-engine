import type { TrustedScope } from '../../contracts/identity/scope.js';
import type { RunId } from '../../contracts/identity/ids.js';
import { parseJsonObject } from '../../contracts/messages/json.js';
import type { JsonObject } from '../../contracts/messages/json.js';
import { resolveToolDiscovery } from '../../contracts/discovery/config.js';
import type { ToolDiscoveryConfig } from '../../contracts/discovery/config.js';
import { parseToolDiscoveryState } from '../../contracts/discovery/state.js';
import type { ToolDiscoveryState, DiscoveryExchange } from '../../contracts/discovery/state.js';
import type { RuntimeTool, ToolIndex } from '../execution/tool-catalog.js';
import { createFingerprint } from '../../shared/fingerprints/fingerprint.js';
import { discoveryCatalog, schemaTokens } from './catalog.js';
import { searchAlternatives } from './fusion.js';
import type { SearchDocument } from './search.js';
import { searchDefinition } from './definition.js';
import { searchArguments } from './arguments.js';

export class ToolDiscovery {
  private readonly catalog: ReturnType<typeof discoveryCatalog>;
  private state: ToolDiscoveryState;
  readonly index: ToolIndex;
  constructor(tools: readonly RuntimeTool[], scope: TrustedScope, runId: RunId, config?: Partial<ToolDiscoveryConfig>, saved?: ToolDiscoveryState) {
    const settings = saved === undefined ? resolveToolDiscovery(config) : parseToolDiscoveryState(saved).settings;
    this.catalog = discoveryCatalog(tools, scope, settings.catalogMaxTools);
    const ownerKey = createFingerprint({ actor: scope.actorId, app: scope.appId, tenant: scope.tenantId ?? null }, { domain: 'tool.discovery.owner', version: '1' });
    const enabled = settings.mode === 'on' || (settings.mode === 'auto' && (tools.length > settings.eagerMaxCount
      || schemaTokens(this.catalog.index.modelTools) > settings.eagerMaxTokens));
    this.state = saved === undefined ? { version: 1, ownerKey, runId, settings, enabled, searches: 0, active: [], exchanges: [] } : parseToolDiscoveryState(saved);
    if (this.state.ownerKey !== ownerKey || this.state.runId !== runId) throw new Error('Discovery checkpoint scope mismatch');
    this.state = { ...this.state, active: this.state.active.filter(item => this.catalog.key(item.alias) === item.key) };
    const current = this;
    this.index = { get modelTools() { return current.modelTools(); }, find(alias) {
      return !current.enabled || current.state.active.some(item => item.alias === alias) ? current.catalog.index.find(alias) : undefined;
    } };
  }
  get enabled() { return this.state.enabled; }
  get canSearch() { return this.state.searches < this.state.settings.maxSearchCalls; }
  get exchanges() { return this.state.exchanges; }
  snapshot(): ToolDiscoveryState { return parseToolDiscoveryState(this.state); }
  record(exchange: DiscoveryExchange) {
    this.state = parseToolDiscoveryState({ ...this.state, exchanges: [...this.state.exchanges, exchange] });
  }
  private modelTools() {
    const all = this.catalog.index.modelTools;
    return !this.enabled ? all : Object.freeze([searchDefinition(this.catalog.sources), ...all.filter(tool => this.state.active.some(item => item.alias === tool.name))]);
  }
  search(args: JsonObject): JsonObject {
    if (this.state.searches >= this.state.settings.maxSearchCalls) return { code: 'search_limit', loaded: [], matches: [] };
    this.state = { ...this.state, searches: this.state.searches + 1 };
    const input = searchArguments(args);
    if (input === undefined) return { code: 'invalid_query', loaded: [], matches: [] };
    const matches = searchAlternatives(this.catalog.documents, input.query, input.alternatives, input.source, this.state.settings.searchTopK);
    const skipped = this.activate(matches);
    const usable = matches.some(hit => this.state.active.some(item => item.alias === hit.tool.name));
    return parseJsonObject({ code: matches.length === 0 ? 'no_matches' : usable ? 'ok' : 'active_schema_budget',
      matches: matches.map(hit => ({ name: hit.tool.name, source: hit.source, description: (hit.tool.description ?? '').slice(0, 240) })),
      loaded: this.state.active.map(item => item.alias), skipped, availableSources: this.catalog.sources });
  }
  private activate(matches: readonly SearchDocument[]): string[] {
    const active = [...this.state.active]; const skipped: string[] = [];
    for (const hit of matches) {
      if (active.some(item => item.alias === hit.tool.name)) continue;
      const next = [...active, { alias: hit.tool.name, key: this.catalog.key(hit.tool.name)! }];
      const schemas = this.catalog.index.modelTools.filter(tool => next.some(item => item.alias === tool.name));
      if (schemaTokens(schemas) > this.state.settings.activeMaxTokens) { skipped.push(hit.tool.name); continue; }
      active.push(next[next.length - 1]!);
    }
    this.state = { ...this.state, active };
    return skipped;
  }
}
