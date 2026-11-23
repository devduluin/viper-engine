import { TOOL_SPIKE_SCHEMA } from './tool-schema.js';

/** S0 schema for the run store spike. It is not the full engine migration. */
export const RUN_SPIKE_SCHEMA = `
CREATE TABLE viper_engine.conversations (
  id TEXT PRIMARY KEY NOT NULL,
  actor_id TEXT NOT NULL, app_id TEXT NOT NULL, tenant_key TEXT NOT NULL,
  title TEXT CHECK (length(title) BETWEEN 1 AND 500),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  next_message_position INTEGER NOT NULL DEFAULT 0 CHECK (next_message_position >= 0),
  created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL, deleted_at_ms INTEGER,
  UNIQUE (id, actor_id, app_id, tenant_key)
) STRICT;
CREATE TABLE viper_engine.runs (
  id TEXT PRIMARY KEY NOT NULL,
  actor_id TEXT NOT NULL, app_id TEXT NOT NULL, tenant_key TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','waiting_for_input','waiting_for_approval','completed','partial','failed','cancelled')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL, cancel_requested_at_ms INTEGER,
  last_event_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_event_sequence >= 0),
  lease_fence INTEGER NOT NULL DEFAULT 0 CHECK (lease_fence >= 0),
  lease_owner TEXT, lease_expires_at_ms INTEGER,
  effort TEXT CHECK (effort IN ('low','medium','high')),
  client_tools TEXT CHECK (json_valid(client_tools) AND json_type(client_tools) = 'array'),
  CHECK ((lease_owner IS NULL) = (lease_expires_at_ms IS NULL)),
  UNIQUE (id, actor_id, app_id, tenant_key),
  UNIQUE (id, conversation_id, actor_id, app_id, tenant_key),
  FOREIGN KEY (conversation_id, actor_id, app_id, tenant_key) REFERENCES conversations (id, actor_id, app_id, tenant_key)
) STRICT;
CREATE TABLE viper_engine.run_deliveries (
  run_id TEXT PRIMARY KEY NOT NULL, actor_id TEXT NOT NULL, app_id TEXT NOT NULL, tenant_key TEXT NOT NULL,
  failures INTEGER NOT NULL CHECK (failures >= 1), failed_fence INTEGER NOT NULL CHECK (failed_fence >= 1),
  available_at_ms INTEGER NOT NULL, failure_code TEXT NOT NULL CHECK
    (failure_code IN ('authentication_required','connection_unavailable','invalid_configuration','execution_failure')),
  FOREIGN KEY (run_id, actor_id, app_id, tenant_key) REFERENCES runs(id, actor_id, app_id, tenant_key)
) STRICT;
CREATE TRIGGER viper_engine.delivery_owner_fixed BEFORE UPDATE ON run_deliveries
WHEN (NEW.actor_id, NEW.app_id, NEW.tenant_key) IS NOT (OLD.actor_id, OLD.app_id, OLD.tenant_key)
BEGIN SELECT RAISE(ABORT, 'delivery owner is immutable'); END;
CREATE TABLE viper_engine.run_events (
  run_id TEXT NOT NULL, sequence INTEGER NOT NULL CHECK (sequence > 0), event_id TEXT NOT NULL UNIQUE,
  actor_id TEXT NOT NULL, app_id TEXT NOT NULL, tenant_key TEXT NOT NULL, conversation_id TEXT NOT NULL,
  type TEXT NOT NULL, step_id TEXT, model_call_id TEXT, tool_call_id TEXT, occurred_at_ms INTEGER NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload) AND json_type(payload) = 'object'),
  PRIMARY KEY (run_id, sequence),
  FOREIGN KEY (run_id, conversation_id, actor_id, app_id, tenant_key)
    REFERENCES runs (id, conversation_id, actor_id, app_id, tenant_key)
) STRICT;
CREATE TRIGGER viper_engine.run_revision_step BEFORE UPDATE OF revision ON runs
WHEN NEW.revision <> OLD.revision + 1 BEGIN SELECT RAISE(ABORT, 'run revision must increase by one'); END;
CREATE TRIGGER viper_engine.conversation_revision_step BEFORE UPDATE OF revision ON conversations
WHEN NEW.revision <> OLD.revision + 1 BEGIN SELECT RAISE(ABORT, 'conversation revision must increase by one'); END;
CREATE TRIGGER viper_engine.run_owner_fixed BEFORE UPDATE ON runs
WHEN (NEW.actor_id, NEW.app_id, NEW.tenant_key) IS NOT (OLD.actor_id, OLD.app_id, OLD.tenant_key)
BEGIN SELECT RAISE(ABORT, 'run owner is immutable'); END;
CREATE TRIGGER viper_engine.conversation_owner_fixed BEFORE UPDATE ON conversations
WHEN (NEW.actor_id, NEW.app_id, NEW.tenant_key) IS NOT (OLD.actor_id, OLD.app_id, OLD.tenant_key)
BEGIN SELECT RAISE(ABORT, 'conversation owner is immutable'); END;
CREATE TRIGGER viper_engine.run_fence_monotonic BEFORE UPDATE OF lease_fence ON runs
WHEN NEW.lease_fence < OLD.lease_fence BEGIN SELECT RAISE(ABORT, 'lease fence cannot decrease'); END;
CREATE TRIGGER viper_engine.event_gap_free BEFORE INSERT ON run_events
WHEN NEW.sequence <> 1 + max(
  (SELECT last_event_sequence FROM runs WHERE id = NEW.run_id),
  coalesce((SELECT max(sequence) FROM run_events WHERE run_id = NEW.run_id), 0))
BEGIN SELECT RAISE(ABORT, 'run event sequence gap'); END;
CREATE TRIGGER viper_engine.event_append_only BEFORE UPDATE ON run_events
BEGIN SELECT RAISE(ABORT, 'run event is immutable'); END;
${TOOL_SPIKE_SCHEMA}`;
