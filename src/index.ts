export { parseFoundationConfig } from './bootstrap/config.js';
export type { FoundationConfig } from './bootstrap/config.js';

export { parseId } from './contracts/identity/ids.js';
export type {
  EntityId, ActorId, AppId, TenantId, ConversationId, RunId, StepId,
  ModelCallId, ToolCallId, MessageId,
} from './contracts/identity/ids.js';
export type { Clock, IdGenerator } from './contracts/identity/ports.js';
export {
  scopeFromAuthenticatedIdentity, assertTrustedScope,
  assertScopeClaimsMatch, sameScope, assertSameScope,
} from './contracts/identity/scope.js';
export type { AuthenticatedIdentity, TrustedScope } from './contracts/identity/scope.js';

export type {
  ContentBlock, TextContent, JsonContent, ImageContent, AudioContent,
  MediaSource, InlineMediaSource, ReferenceMediaSource,
} from './contracts/messages/content.js';
export type {
  Message, ContextMessage, AssistantMessage, ToolResultMessage, ToolCall, ToolOutcome,
} from './contracts/messages/message.js';
export { parseJsonValue, parseJsonObject } from './contracts/messages/json.js';
export type { JsonValue, JsonObject } from './contracts/messages/json.js';
export { parseContentBlock, parseContent } from './contracts/messages/parse-content.js';
export { parseMessage, parseToolCall } from './contracts/messages/parse-message.js';
export { assertMessageHistory, parseMessageHistory } from './contracts/messages/history.js';
export type { HistoryValidationOptions } from './contracts/messages/history.js';

export { API_SCHEMA_DOCUMENT, API_SCHEMA_ID } from './contracts/api/schemas.js';
export { OPENAPI_DOCUMENT } from './contracts/api/openapi.js';
export { API_ERROR_STATUS } from './contracts/api/errors.js';
export type { ApiErrorCode } from './contracts/api/errors.js';
export { createDurableRunDriver } from './bootstrap/durable.js';
export type { RunJournal, JournalCommand } from './contracts/state/journal.js';
export type { RunCheckpoint, CheckpointReader, MessageStore } from './contracts/state/checkpoints.js';
export { createViperEngine } from './bootstrap/engine.js';
export type { ViperEngineOptions } from './bootstrap/engine-types.js';
export { parseConfiguredModelConfig, createConfiguredModelBinding } from './bootstrap/configured-model.js';
export { runEffortFromDatabase } from './bootstrap/model.js';
export type { RunEffortLookup } from './bootstrap/model.js';
export { createModelTitler } from './bootstrap/conversation-titles.js';
export type { ClientToolRecord } from './bootstrap/engine-types.js';
export type { EngineModel, ConfiguredModel } from './bootstrap/configured-model.js';
export { EngineSetupError } from './bootstrap/mcp-tools.js';
export type { ConnectionBinding } from './bootstrap/mcp-tools.js';
export { createEngineHttpServer, persistedRunInstructions } from './bootstrap/http.js';
export { engineTransactionStores } from './bootstrap/api-database.js';
export type { EngineHttpOptions } from './bootstrap/http.js';
export { ApiFailure } from './contracts/api/failure.js';
export type { ApiHandler, ApiCall, ApiOperation, ApiCursorPort } from './contracts/api/control.js';
export { createEngineWorker } from './bootstrap/worker/index.js';
export type { EngineWorkerOptions, WorkerEvent, WorkerHandle, WorkerStatus } from './bootstrap/worker/index.js';
export { runWorkerUntilSignal } from './bootstrap/worker/process.js';
export type { WorkerFailureCode, WorkerRetryPolicy, WorkerDelivery } from './contracts/worker/control.js';
export type { EventStreamOptions } from './bootstrap/event-replay.js';
export type { EventReplay, ReplayBatch } from './contracts/events/replay.js';
export { createEngineClient } from './bootstrap/client.js';
export type { EngineClient, EngineClientOptions } from './bootstrap/client.js';
export { EngineClientFailure } from './contracts/client/failure.js';
export type { ClientFailureCode, ClientRecovery } from './contracts/client/failure.js';
export type { ClientCheckpoint, ClientEvent, ClientUpdate, EngineClientPort, WatchOptions } from './contracts/client/ports.js';
export type { RunSnapshotView, RunAcceptedView, ConversationView, ApprovalView, ConnectionView,
  ConnectionPageView, CapabilitiesView, DurableEventView } from './contracts/client/views.js';
export type { StartRunView, SubmitInputView, DecideApprovalView } from './contracts/client/requests.js';
export type { RunUsage } from './contracts/models/run-usage.js';
export { DEFAULT_CONTEXT_BUDGET, resolveContextBudget } from './contracts/context/budget.js';
export type { ContextBudget } from './contracts/context/budget.js';
export type { ContextCheckpoint, ContextReport } from './contracts/context/checkpoint.js';
export { createEngineRecall } from './bootstrap/recall.js';
export { createUserMemory } from './bootstrap/user-memory.js';
export type { UserMemoryPort, MemorySave, MemoryDelete } from './contracts/recall/user-memory.js';
export type { RecallNote, NoteSource, NoteChange, HistoryHit, RecallPage, RecallStore } from './contracts/recall/ports.js';
export type { ContextEvidenceProvider } from './contracts/context/evidence.js';
export { createEngineLearning } from './bootstrap/learning.js';
export type { LearningStore, OutcomeFeedback, FeedbackInput, ProposalInput, ProposalReview,
  MemoryProposal, ProposalChange, ProposalStatus, FeedbackVerdict } from './contracts/learning/ports.js';
export { createPlanEvidence } from './bootstrap/planning.js';
export type { PlanEvidenceBinding } from './bootstrap/planning.js';
export { parseContextPlan } from './contracts/planning/validation.js';
export { PLAN_LIMITS } from './contracts/planning/plan.js';
export type { ContextPlan, ContextPlanStep } from './contracts/planning/plan.js';
export { startEngineHost } from './bootstrap/operations/host.js';
export type { EngineHostOptions } from './bootstrap/operations/host.js';
export { runEngineHostUntilSignal } from './bootstrap/operations/signals.js';
export type { Readiness, ReadinessCode } from './bootstrap/operations/readiness.js';
export { createDatabasePool, openSqliteDatabase, migrateDatabase, assertSchemaReady, SchemaNotReadyError } from './bootstrap/database.js';
export type { SqlitePool, SqliteFiles } from './bootstrap/database.js';
export { parseDatabaseConfig } from './bootstrap/database-config.js';
export type { DatabaseConfig } from './bootstrap/database-config.js';
export { parseToolDiscoveryConfig } from './bootstrap/tool-discovery-config.js';
export { parseBudgetProfiles } from './bootstrap/budget-profiles.js';
export { DEFAULT_BUDGET_PROFILES, validateBudgetProfiles } from './contracts/models/budget-profiles.js';
export type { BudgetProfiles, ModeBudget, BudgetMode } from './contracts/models/budget-profiles.js';
export { DEFAULT_TOOL_DISCOVERY, resolveToolDiscovery } from './contracts/discovery/config.js';
export type { ToolDiscoveryConfig } from './contracts/discovery/config.js';
export type { AgentProfile } from './contracts/state/agents.js';
export type { SubAgentOptions } from './contracts/api/sub-agents.js';
