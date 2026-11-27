/** S0 journal tables. Apply after the run schema. */
export const JOURNAL_SPIKE_SCHEMA = `
CREATE TABLE viper_engine.run_steps (
  run_id TEXT NOT NULL, step_index INTEGER NOT NULL CHECK (step_index >= 1), id TEXT NOT NULL UNIQUE,
  actor_id TEXT NOT NULL, app_id TEXT NOT NULL, tenant_key TEXT NOT NULL,
  decision_kind TEXT CHECK (decision_kind IN ('final','tool_calls','needs_input')),
  started_at_ms INTEGER NOT NULL, ended_at_ms INTEGER CHECK (ended_at_ms >= started_at_ms),
  PRIMARY KEY (run_id, step_index), UNIQUE (run_id, id),
  FOREIGN KEY (run_id, actor_id, app_id, tenant_key) REFERENCES runs(id, actor_id, app_id, tenant_key)
) STRICT;
CREATE TABLE viper_engine.model_calls (
  id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL, step_id TEXT NOT NULL,
  actor_id TEXT NOT NULL, app_id TEXT NOT NULL, tenant_key TEXT NOT NULL,
  attempt INTEGER NOT NULL CHECK (attempt >= 1),
  provider TEXT NOT NULL CHECK (length(provider) BETWEEN 1 AND 128),
  model TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 256),
  usage_source TEXT NOT NULL CHECK (usage_source IN ('provider','estimate','unavailable')),
  outcome TEXT NOT NULL CHECK (outcome IN ('pending','succeeded','failed','cancelled')),
  failure_code TEXT CHECK (length(failure_code) BETWEEN 1 AND 64),
  failure_detail TEXT CHECK (failure_detail IS NULL OR (outcome = 'failed' AND length(failure_detail) BETWEEN 1 AND 200)),
  input_tokens INTEGER CHECK (input_tokens >= 0), output_tokens INTEGER CHECK (output_tokens >= 0),
  total_tokens INTEGER CHECK (total_tokens >= 0), cache_read_tokens INTEGER CHECK (cache_read_tokens >= 0),
  cache_write_tokens INTEGER CHECK (cache_write_tokens >= 0),
  started_at_ms INTEGER NOT NULL, ended_at_ms INTEGER CHECK (ended_at_ms >= started_at_ms),
  CHECK ((outcome = 'failed') = (failure_code IS NOT NULL)),
  CHECK (usage_source <> 'unavailable' OR (input_tokens IS NULL AND output_tokens IS NULL AND total_tokens IS NULL)),
  UNIQUE (step_id, attempt),
  FOREIGN KEY (run_id, step_id) REFERENCES run_steps(run_id, id),
  FOREIGN KEY (run_id, actor_id, app_id, tenant_key) REFERENCES runs(id, actor_id, app_id, tenant_key)
) STRICT;
CREATE INDEX viper_engine.model_calls_run ON model_calls(run_id);
CREATE TABLE viper_engine.runtime_checkpoints (
  run_id TEXT PRIMARY KEY NOT NULL, actor_id TEXT NOT NULL, app_id TEXT NOT NULL, tenant_key TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  state TEXT NOT NULL CHECK (json_valid(state) AND json_type(state) = 'object' AND length(CAST(state AS BLOB)) <= 2097152),
  FOREIGN KEY (run_id, actor_id, app_id, tenant_key) REFERENCES runs(id, actor_id, app_id, tenant_key)
) STRICT;
CREATE TRIGGER viper_engine.checkpoint_guard BEFORE UPDATE ON runtime_checkpoints
WHEN NEW.revision <> OLD.revision + 1 OR (NEW.run_id, NEW.actor_id, NEW.app_id, NEW.tenant_key)
  IS NOT (OLD.run_id, OLD.actor_id, OLD.app_id, OLD.tenant_key)
BEGIN SELECT RAISE(ABORT, 'invalid checkpoint mutation'); END;
CREATE TABLE viper_engine.run_steering_inputs (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT NOT NULL UNIQUE, run_id TEXT NOT NULL,
  actor_id TEXT NOT NULL, app_id TEXT NOT NULL, tenant_key TEXT NOT NULL, input_id TEXT NOT NULL,
  message TEXT NOT NULL CHECK (json_valid(message) AND json_type(message) = 'object'
    AND json_extract(message,'$.role') IS 'user' AND json_extract(message,'$.id') IS message_id
    AND length(CAST(message AS BLOB)) <= 33554432),
  created_at_ms INTEGER NOT NULL, settled_at_ms INTEGER, outcome TEXT CHECK (outcome IN ('consumed','discarded')),
  CHECK ((settled_at_ms IS NULL) = (outcome IS NULL)),
  UNIQUE (run_id, input_id),
  FOREIGN KEY (run_id, actor_id, app_id, tenant_key) REFERENCES runs(id, actor_id, app_id, tenant_key)
) STRICT;
CREATE INDEX viper_engine.steering_pending ON run_steering_inputs(run_id, seq) WHERE settled_at_ms IS NULL;
CREATE TRIGGER viper_engine.steering_once BEFORE UPDATE ON run_steering_inputs
WHEN OLD.settled_at_ms IS NOT NULL OR NEW.settled_at_ms IS NULL
  OR (NEW.seq, NEW.message_id, NEW.run_id, NEW.actor_id, NEW.app_id, NEW.tenant_key, NEW.input_id, NEW.message, NEW.created_at_ms)
  IS NOT (OLD.seq, OLD.message_id, OLD.run_id, OLD.actor_id, OLD.app_id, OLD.tenant_key, OLD.input_id, OLD.message, OLD.created_at_ms)
BEGIN SELECT RAISE(ABORT, 'invalid steering mutation'); END;
CREATE TRIGGER viper_engine.steering_no_delete BEFORE DELETE ON run_steering_inputs
BEGIN SELECT RAISE(ABORT, 'steering input cannot be deleted'); END;
`;
