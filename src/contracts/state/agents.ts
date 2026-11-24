import type { ConversationId, RunId } from '../identity/ids.js';
import type { TrustedScope } from '../identity/scope.js';
import type { RunStatus } from './run-state.js';

/** A sub-agent run as its parent sees it (PLAN-SUBAGENTS §3). */
export interface AgentChildRecord {
  readonly runId: RunId;
  readonly conversationId: ConversationId;
  readonly profile: string;
  readonly spawnKey: string;
  readonly status: RunStatus;
}

/** Lineage of any run; a root run has depth 0 and no parent. */
export interface RunLineage {
  readonly runId: RunId;
  readonly conversationId: ConversationId;
  readonly rootRunId: RunId;
  readonly depth: number;
  readonly status: RunStatus;
  /** Sub-agent profile of a child run; absent for a root run. */
  readonly profile?: string;
}

export interface AgentChildInput {
  readonly parent: RunLineage;
  readonly runId: RunId;
  readonly conversationId: ConversationId;
  readonly linkId: string;
  readonly profile: string;
  readonly spawnKey: string;
  /** Model tier the parent asked for; stored on the spawned link, resolved to a model by the host. */
  readonly tier?: 'fast' | 'balanced' | 'deep';
  readonly title: string;
  readonly at: number;
}

/**
 * Persistence of sub-agent lineage and links. Runs inside an ApiDatabase transaction together with the message and
 * run stores, so spawning (conversation, run, link, brief) is atomic. Settlement and waking are database triggers.
 */
export interface AgentRunStore {
  lineage(scope: TrustedScope, runId: RunId): Promise<RunLineage | undefined>;
  findSpawn(scope: TrustedScope, parentRunId: RunId, spawnKey: string): Promise<AgentChildRecord | undefined>;
  /** Children of the whole tree under `rootRunId`: live ones and all ever spawned. */
  treeCounts(scope: TrustedScope, rootRunId: RunId): Promise<{ readonly live: number; readonly total: number }>;
  createChild(scope: TrustedScope, input: AgentChildInput): Promise<AgentChildRecord>;
  children(scope: TrustedScope, parentRunId: RunId): Promise<readonly AgentChildRecord[]>;
  /** Records awaits links (already satisfied for settled children) and returns how many are still open. */
  awaitChildren(scope: TrustedScope, parentRunId: RunId, links: readonly { readonly linkId: string; readonly childRunId: RunId }[], at: number): Promise<number>;
  /** Text of the child's last assistant message, at most `maxBytes` UTF-8 bytes (cut marked). */
  finalText(scope: TrustedScope, child: AgentChildRecord, maxBytes: number): Promise<string>;
  /** Model(s) and tokens the child used, for cost display; tokens are null when the provider reported none. */
  usage(scope: TrustedScope, child: AgentChildRecord): Promise<{ readonly model?: string; readonly tokens: number | null }>;
}

/** A host-defined sub-agent role (PLAN-SUBAGENTS §6.2). `tools` narrows the parent's tools; absent = the same tools. */
export interface AgentProfile {
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly tools?: readonly string[];
}
