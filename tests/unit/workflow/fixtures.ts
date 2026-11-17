import { AgentRunSession } from '../../../src/application/runs/session.js';
import type { SessionDependencies, SessionView } from '../../../src/application/runs/session-state.js';
import type { ModelResult } from '../../../src/contracts/models/gateway.js';
import type { McpGateway } from '../../../src/contracts/mcp/gateway.js';
import type { RunLoopInput } from '../../../src/agent/runtime/types.js';
import { harness } from '../runtime/harness.js';

export function workflow(frames: readonly ModelResult[], mcp: McpGateway,
  overrides: { input?: Partial<RunLoopInput>; deps?: Partial<SessionDependencies> } = {}) {
  const h = harness(frames, mcp, { ...overrides, deps: { ...overrides.deps,
    policy: overrides.deps?.policy ?? { decide: tool => tool.alias === 'save' ? 'requires_approval' : 'execute' },
  } });
  const deps: SessionDependencies = { ...h.deps, refreshTools: async () => h.input.tools, ...overrides.deps };
  return { ...h, deps, start: () => AgentRunSession.start(h.input, deps) };
}

export function approvalAction(view: SessionView) {
  const action = view.actions.find(item => item.kind === 'approval_required');
  if (action === undefined || action.kind !== 'approval_required') throw new Error('Expected approval action');
  return action;
}

export function accept(view: SessionView) {
  const action = approvalAction(view);
  return { approvalId: action.approvalId, expectedRevision: action.revision, binding: action.binding, decision: 'accept' as const };
}
