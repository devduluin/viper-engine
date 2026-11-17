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

export interface ViperEngineOptions {
  readonly model: EngineModel;
  readonly credentials: McpCredentialPort;
  readonly resolveEndpoint: (server: McpServerEndpoint) => McpTransportConfig;
  /** Server selection/auth, never a connection list supplied by the model. */
  readonly connections: (scope: TrustedScope, checkpoint: RunCheckpoint) => Promise<readonly ConnectionBinding[]>;
  readonly policy: ToolCallPolicy;
  readonly instructions?: readonly Message[] | ((scope: TrustedScope, checkpoint: RunCheckpoint) => Promise<readonly Message[]>);
  readonly maxModelCalls?: number; readonly maxOutputTokens?: number; readonly limits?: Partial<RunLimits>;
  /** Defaults to the engine's bounded text/byte policy; choose the actual provider window explicitly. */
  readonly context?: Partial<ContextBudget>;
  readonly contextEvidence?: ContextEvidenceProvider;
  readonly clock?: Clock; readonly ids?: IdGenerator;
  readonly connectTimeoutMs?: number; readonly requestTimeoutMs?: number; readonly discoveryTimeoutMs?: number;
  readonly maxConnections?: number; readonly maxPages?: number; readonly maxTools?: number;
  readonly leaseMs?: number; readonly heartbeatMs?: number;
  /** How long a pending human approval stays decidable (ms, default 60000). */
  readonly approvalTtlMs?: number;
  readonly onEvent?: (event: RuntimeEvent) => void | Promise<void>;
  readonly onDeliveryFailure?: (claim: RunClaim, error: unknown) => Promise<void>;
}
