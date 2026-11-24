import type { ApiDatabase, ApiStores } from '../../contracts/api/control.js';
import { parseId } from '../../contracts/identity/ids.js';
import type { RunId } from '../../contracts/identity/ids.js';
import type { IdGenerator } from '../../contracts/identity/ports.js';
import type { TrustedScope } from '../../contracts/identity/scope.js';
import { parseMessage } from '../../contracts/messages/parse-message.js';
import type { Message } from '../../contracts/messages/message.js';
import type { AgentChildRecord, RunLineage } from '../../contracts/state/agents.js';
import { isTerminalRunStatus } from '../../contracts/state/run-state.js';
import { requireState } from '../../contracts/api/failure.js';
import { AgentError } from '../../agent/runtime/agent-port.js';
import type { AgentPort, AgentReport, AgentView } from '../../agent/runtime/agent-port.js';
import type { RuntimeTool } from '../../agent/execution/tool-catalog.js';

/** A host-defined sub-agent role (PLAN-SUBAGENTS §6.2). `tools` narrows the parent's tools; absent = the same tools. */
export interface AgentProfile {
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly tools?: readonly string[];
}

export interface SubAgentOptions {
  readonly database: ApiDatabase;
  readonly profiles: readonly AgentProfile[];
  /** Defaults (PLAN-SUBAGENTS §16 Q2): depth 1, 3 live and 12 total sub-agents per tree, 16 KB per report. */
  readonly maxDepth?: number;
  readonly maxLive?: number;
  readonly maxPerTree?: number;
  readonly reportBytes?: number;
}

interface Binding { readonly options: SubAgentOptions; readonly scope: TrustedScope; readonly run: RunLineage;
  readonly ids: IdGenerator; readonly now: () => number }

export function createAgentPort(binding: Binding): AgentPort {
  const { options, scope, run } = binding;
  const tx = <T>(work: (stores: ApiStores) => Promise<T>) => options.database.transaction(work);
  const view = (child: AgentChildRecord): AgentView => ({ id: child.runId, key: child.spawnKey, profile: child.profile, status: child.status });
  const reports = async (stores: ApiStores, children: readonly AgentChildRecord[]) => Promise.all(children.map(async (child): Promise<AgentReport> => ({
    ...view(child), report: await stores.agents.finalText(scope, child, options.reportBytes ?? 16384) })));
  return {
    profiles: options.profiles.map(profile => ({ name: profile.name, description: profile.description })),
    spawn: input => tx(stores => spawn(binding, stores, input)).then(view),
    status: () => tx(stores => stores.agents.children(scope, run.runId)).then(children => children.map(view)),
    wait: agents => tx(async stores => {
      const children = await stores.agents.children(scope, run.runId);
      const wanted = agents === 'all' ? children : children.filter(child => agents.includes(child.runId));
      if (agents !== 'all' && wanted.length !== agents.length) throw new AgentError('AGENT_NOT_FOUND', 'Only sub-agents of this run can be awaited.');
      const open = await stores.agents.awaitChildren(scope, run.runId, wanted.map(child => ({ linkId: binding.ids.next('run_link'), childRunId: child.runId })), binding.now());
      return { settled: await reports(stores, wanted.filter(child => isTerminalRunStatus(child.status))), open };
    }),
    cancel: agents => tx(async stores => {
      const children = (await stores.agents.children(scope, run.runId)).filter(child => agents.includes(child.runId));
      for (const child of children) requireState(await stores.runs.requestCancellation(scope, child.runId, binding.now(), []));
      return children.map(view);
    }),
    awaitedReports: () => tx(async stores => reports(stores, (await stores.agents.children(scope, run.runId))
      .filter(child => isTerminalRunStatus(child.status)))),
  };
}

async function spawn(binding: Binding, stores: ApiStores, input: { task: string; profile: string; key: string }) {
  const { options, scope, run } = binding;
  const profile = options.profiles.find(item => item.name === input.profile);
  if (profile === undefined) throw new AgentError('AGENT_UNKNOWN_PROFILE', `Unknown profile "${input.profile}".`);
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(input.key)) throw new AgentError('AGENT_INVALID_REQUEST', 'key: 1-64 letters, digits, "_", "-" or ".".');
  const existing = await stores.agents.findSpawn(scope, run.runId, input.key);
  if (existing !== undefined) return existing; // same key = same sub-agent (idempotent under retries and unknown outcomes)
  if (run.depth + 1 > (options.maxDepth ?? 1)) throw new AgentError('AGENT_DEPTH_LIMIT', 'Sub-agents cannot start further sub-agents.');
  const counts = await stores.agents.treeCounts(scope, run.rootRunId);
  if (counts.live >= (options.maxLive ?? 3)) throw new AgentError('AGENT_LIMIT_REACHED', 'Too many sub-agents are running; wait for one first.');
  if (counts.total >= (options.maxPerTree ?? 12)) throw new AgentError('AGENT_LIMIT_REACHED', 'This task already used its sub-agent allowance.');
  const at = binding.now();
  const child = await stores.agents.createChild(scope, { parent: run, runId: binding.ids.next('run'),
    conversationId: binding.ids.next('conversation'), linkId: binding.ids.next('run_link'), profile: profile.name,
    spawnKey: input.key, title: `${profile.name}: ${input.key}`, at });
  requireState(await stores.messages.append(scope, child.conversationId, { expectedRevision: 1, at, runId: child.runId,
    messages: [brief(binding, input.task)] }));
  return child;
}

/** The child sees only this brief (PLAN-SUBAGENTS §9), never the parent's transcript. */
function brief(binding: Binding, task: string): Message {
  return parseMessage({ id: binding.ids.next('message'), role: 'user', content: [{ type: 'text', text: [
    'You are a sub-agent working for another agent. Complete the task below and end with a concise report:',
    'what you found or did, evidence (file:line, commands, results), and anything left open. Do not ask questions;',
    'state assumptions instead.', '', 'Task:', task].join('\n') }] });
}

/** Child runs: the profile narrows the parent's tools and adds its instructions; it can never add a tool. */
export function applyAgentProfile<T extends { readonly tools: readonly RuntimeTool[]; readonly instructions?: readonly Message[] }>(
  plan: T, profile: AgentProfile | undefined, ids: IdGenerator): T {
  if (profile === undefined) return { ...plan, tools: [] }; // unknown profile: refuse every tool rather than guess
  const allowed = profile.tools;
  const tools = allowed === undefined ? plan.tools
    : plan.tools.filter(tool => allowed.includes(tool.alias) || allowed.includes(tool.definition.ref.name));
  const instruction = parseMessage({ id: ids.next('message'), role: 'system', content: [{ type: 'text', text: profile.instructions }] });
  return { ...plan, tools, instructions: [...(plan.instructions ?? []), instruction] };
}

export async function runLineage(options: SubAgentOptions, scope: TrustedScope, runId: RunId) {
  return options.database.snapshot(stores => stores.agents.lineage(scope, parseId('run', runId)));
}

/** Per delivery: shape a child's plan by its profile and offer sub-agent tools while the depth allows it. */
export async function subAgentWiring<T extends { readonly tools: readonly RuntimeTool[]; readonly instructions?: readonly Message[] }>(
  options: SubAgentOptions | undefined, context: { readonly scope: TrustedScope; readonly runId: RunId; readonly ids: IdGenerator;
    readonly now: () => number; readonly cancelled: boolean }, plan: T): Promise<{ readonly plan: T; readonly agents?: AgentPort }> {
  if (options === undefined || context.cancelled) return { plan };
  const run = await runLineage(options, context.scope, context.runId);
  if (run === undefined) return { plan };
  const shaped = run.depth > 0 ? applyAgentProfile(plan, options.profiles.find(profile => profile.name === run.profile), context.ids) : plan;
  if (run.depth >= (options.maxDepth ?? 1)) return { plan: shaped };
  return { plan: shaped, agents: createAgentPort({ options, scope: context.scope, run, ids: context.ids, now: context.now }) };
}
