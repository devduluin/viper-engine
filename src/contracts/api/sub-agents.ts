import type { ApiDatabase } from './control.js';
import type { AgentProfile } from '../state/agents.js';

/** Host options for sub-agents (PLAN-SUBAGENTS); the engine adds the database from its own pool. */
export interface SubAgentOptions {
  readonly database: ApiDatabase;
  readonly profiles: readonly AgentProfile[];
  /** Defaults (PLAN-SUBAGENTS §16 Q2): depth 1, 3 live and 12 total sub-agents per tree, 16 KB per report. */
  readonly maxDepth?: number;
  readonly maxLive?: number;
  readonly maxPerTree?: number;
  readonly reportBytes?: number;
}
