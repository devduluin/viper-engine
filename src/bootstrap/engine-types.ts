import type { ClientToolRecord } from '../application/streaming/client-tools.js';
export type { ClientToolRecord } from '../application/streaming/client-tools.js';
import type { Clock, IdGenerator } from '../contracts/identity/ports.js';
import type { TrustedScope } from '../contracts/identity/scope.js';
import type { RunCheckpoint } from '../contracts/state/checkpoints.js';
import type { McpCredentialPort, McpServerEndpoint } from '../contracts/mcp/access.js';
import type { Message } from '../contracts/messages/message.js';
import type { RunLimits } from '../agent/policies/limits.js';
import type { ToolCallPolicy } from '../agent/execution/plan-call.js';
import type { RuntimeEvent } from '../agent/runtime/types.js';
import type { McpTransportConfig } from '../adapters/mcp/client/transport.js';
import type { ConnectionBinding } from './mcp-tools.js';
import type { EngineModel } from './configured-model.js';
import type { RunClaim } from '../contracts/state/leases.js';
import type { ContextBudget } from '../contracts/context/budget.js';
import type { ContextEvidenceProvider } from '../contracts/context/evidence.js';
import type { ToolDiscoveryConfig } from '../contracts/discovery/config.js';

export interface ClientToolsConfig {
  /** Names without prefix (`read_page`); the model sees `client__<name>`. */
  readonly definitions: readonly { readonly name: string; readonly description: string; readonly inputSchema: import('../contracts/messages/json.js').JsonObject }[];
  /** How long a run waits for the client (default 20 s). */
  readonly timeoutMs?: number;
  /**
   * One record per client tool request and per unexpected reply (late, duplicate, unmatched), for logs.
   * Carries ids, result, the client's reason code, duration and size, never the tool's data.
   * Exceptions are swallowed.
   */
  readonly onResult?: (record: ClientToolRecord) => void;
}

export interface ViperEngineOptions {
  readonly userMemory?: boolean;
  /** Sub-agents (PLAN-SUBAGENTS): host-defined profiles and limits; absent = off. */
  readonly subAgents?: Omit<import('../application/durable/agents.js').SubAgentOptions, 'database'>;
  readonly budgetProfiles?: import('../contracts/models/budget-profiles.js').BudgetProfiles;
  readonly defaultBudgetMode?: import('../contracts/models/budget-profiles.js').BudgetMode;
  readonly model: EngineModel;
  /** A host-owned task may use isolated text execution with a bound prompt and no tool ports. */
  readonly isolatedTask?: (scope: TrustedScope, checkpoint: RunCheckpoint) => Promise<readonly Message[] | undefined>;
  readonly resolveRunModel?: (pinned?: { readonly provider: string; readonly model: string },
    runId?: import('../contracts/identity/ids.js').RunId) => EngineModel | Promise<EngineModel>;
  readonly credentials: McpCredentialPort;
  readonly resolveEndpoint: (server: McpServerEndpoint) => McpTransportConfig;
  /** Server selection/auth, never a connection list supplied by the model. */
  readonly connections: (scope: TrustedScope, checkpoint: RunCheckpoint) => Promise<readonly ConnectionBinding[]>;
  readonly policy: ToolCallPolicy;
  readonly instructions?: readonly Message[] | ((scope: TrustedScope, checkpoint: RunCheckpoint) => Promise<readonly Message[]>);
  readonly maxModelCalls?: number; readonly maxOutputTokens?: number; readonly limits?: Partial<RunLimits>;
  /** Defaults to the engine's bounded text/byte policy; choose the actual provider window explicitly. */
  readonly context?: Partial<ContextBudget>;
  /** Per-model context budget, applied to each run for the model it is pinned to (see DurableDriverDependencies). */
  readonly contextForModel?: (model: { readonly provider?: string; readonly model: string }) => Partial<ContextBudget> | undefined;
  readonly contextEvidence?: ContextEvidenceProvider;
  /** Tools the user's client runs (e.g. read_page in the embed panel), offered only to runs that ask for them. */
  readonly clientTools?: ClientToolsConfig;
  readonly toolDiscovery?: Partial<ToolDiscoveryConfig>;
  readonly clock?: Clock; readonly ids?: IdGenerator;
  readonly connectTimeoutMs?: number; readonly requestTimeoutMs?: number; readonly discoveryTimeoutMs?: number;
  readonly maxConnections?: number; readonly maxPages?: number; readonly maxTools?: number;
  readonly leaseMs?: number; readonly heartbeatMs?: number;
  /** How long a pending human approval stays decidable (ms, default 60000). */
  readonly approvalTtlMs?: number;
  readonly onEvent?: (event: RuntimeEvent) => void | Promise<void>;
  readonly onDeliveryFailure?: (claim: RunClaim, error: unknown) => Promise<void>;
}
