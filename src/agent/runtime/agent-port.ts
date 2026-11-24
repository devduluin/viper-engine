/** What the parent model may know about a sub-agent. Ids are run ids; reports are bounded text. */
export interface AgentView {
  readonly id: string;
  readonly key: string;
  readonly profile: string;
  readonly status: string;
}
export interface AgentReport extends AgentView {
  readonly report: string;
}
export interface AgentProfileInfo {
  readonly name: string;
  readonly description: string;
}

/** Refusals the model can act on (PLAN-SUBAGENTS §7); anything else is an engine failure. */
export type AgentErrorCode = 'AGENT_DEPTH_LIMIT' | 'AGENT_LIMIT_REACHED' | 'AGENT_UNKNOWN_PROFILE' | 'AGENT_NOT_FOUND' | 'AGENT_INVALID_REQUEST';
export class AgentError extends Error {
  constructor(readonly code: AgentErrorCode, message: string) { super(message); this.name = 'AgentError'; }
}

/** Sub-agent operations bound to one running parent run; implemented by the durable application layer. */
export interface AgentPort {
  readonly profiles: readonly AgentProfileInfo[];
  spawn(input: { readonly task: string; readonly profile: string; readonly key: string }): Promise<AgentView>;
  status(): Promise<readonly AgentView[]>;
  /** Records the wait and returns the settled reports plus how many awaited sub-agents are still running. */
  wait(agents: readonly string[] | 'all'): Promise<{ readonly settled: readonly AgentReport[]; readonly open: number }>;
  cancel(agents: readonly string[]): Promise<readonly AgentView[]>;
  /** Settled, awaited sub-agents; the runtime delivers the ones not yet in the conversation after a wake. */
  awaitedReports(): Promise<readonly AgentReport[]>;
}
