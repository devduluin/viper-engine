import { ToolDiscovery } from '../../agent/discovery/controller.js';
import type { SessionState } from './session-state.js';

/** Refresh authorized tools while retaining this run's discovery settings and selected versions. */
export async function refreshSessionCatalog(state: SessionState) {
  const context = state.context;
  const tools = await state.deps.refreshTools(context.input.scope);
  const discovery = new ToolDiscovery(tools, context.input.scope, context.input.runId,
    undefined, context.discovery.snapshot());
  state.context = { ...context, discovery, index: discovery.index };
  return discovery.index;
}
