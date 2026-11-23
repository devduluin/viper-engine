/** S0 tool, attempt and connection shape. Apply after the run schema. */
export const TOOL_SPIKE_SCHEMA = `
CREATE TABLE viper_engine.mcp_servers (
  id TEXT PRIMARY KEY NOT NULL, app_id TEXT NOT NULL, tenant_key TEXT NOT NULL, owner_actor_id TEXT,
  transport TEXT NOT NULL CHECK (transport IN ('stdio','streamable_http')),
  endpoint_ref TEXT NOT NULL CHECK (length(endpoint_ref) BETWEEN 1 AND 2048),
  config TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(config) AND json_type(config) = 'object' AND length(CAST(config AS BLOB)) <= 65536),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
  UNIQUE (id, app_id, tenant_key)
) STRICT;
CREATE TABLE viper_engine.mcp_connections (
  id TEXT PRIMARY KEY NOT NULL, server_id TEXT NOT NULL,
  actor_id TEXT NOT NULL, app_id TEXT NOT NULL, tenant_key TEXT NOT NULL,
  auth_state TEXT NOT NULL CHECK (auth_state IN ('ready','authentication_required','revoked')),
  secret_ref TEXT CHECK (length(secret_ref) BETWEEN 1 AND 512),
  granted_capabilities TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(granted_capabilities)
    AND json_type(granted_capabilities) = 'object' AND length(CAST(granted_capabilities AS BLOB)) <= 16384),
  created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL, revoked_at_ms INTEGER,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  CHECK ((auth_state = 'revoked') = (revoked_at_ms IS NOT NULL)),
  UNIQUE (id, server_id, actor_id, app_id, tenant_key),
  FOREIGN KEY (server_id, app_id, tenant_key) REFERENCES mcp_servers(id, app_id, tenant_key)
) STRICT;
CREATE UNIQUE INDEX viper_engine.mcp_connections_live_binding
  ON mcp_connections(server_id, actor_id, app_id, tenant_key) WHERE revoked_at_ms IS NULL;
CREATE TABLE viper_engine.tool_calls (
  run_id TEXT NOT NULL, id TEXT NOT NULL, actor_id TEXT NOT NULL, app_id TEXT NOT NULL, tenant_key TEXT NOT NULL,
  step_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('proposed','awaiting_approval','ready','dispatching','retry_wait',
    'succeeded','failed','unknown','rejected','cancelled')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  connection_id TEXT NOT NULL, server_id TEXT NOT NULL,
  tool_name TEXT NOT NULL CHECK (length(trim(tool_name)) BETWEEN 1 AND 256),
  definition_version TEXT NOT NULL CHECK (length(trim(definition_version)) BETWEEN 1 AND 256),
  arguments_digest TEXT NOT NULL CHECK (length(arguments_digest) = 64 AND arguments_digest NOT GLOB '*[^0-9a-f]*'),
  requires_approval INTEGER NOT NULL CHECK (requires_approval IN (0, 1)),
  created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
  CHECK (attempts >= 1 OR status IN ('proposed','awaiting_approval','ready','rejected','cancelled')),
  PRIMARY KEY (run_id, id),
  UNIQUE (run_id, id, actor_id, app_id, tenant_key),
  UNIQUE (run_id, id, connection_id, server_id, tool_name, definition_version, arguments_digest, actor_id, app_id, tenant_key),
  FOREIGN KEY (run_id, actor_id, app_id, tenant_key) REFERENCES runs(id, actor_id, app_id, tenant_key),
  FOREIGN KEY (connection_id, server_id, actor_id, app_id, tenant_key)
    REFERENCES mcp_connections(id, server_id, actor_id, app_id, tenant_key)
) STRICT;
CREATE INDEX viper_engine.tool_calls_run_status ON tool_calls (run_id, status);
CREATE TRIGGER viper_engine.tool_call_guard BEFORE UPDATE ON tool_calls
WHEN NEW.revision <> OLD.revision + 1 OR NEW.attempts < OLD.attempts
  OR (NEW.run_id, NEW.id, NEW.actor_id, NEW.app_id, NEW.tenant_key, NEW.step_id, NEW.connection_id,
      NEW.server_id, NEW.tool_name, NEW.definition_version, NEW.arguments_digest, NEW.requires_approval)
  IS NOT (OLD.run_id, OLD.id, OLD.actor_id, OLD.app_id, OLD.tenant_key, OLD.step_id, OLD.connection_id,
      OLD.server_id, OLD.tool_name, OLD.definition_version, OLD.arguments_digest, OLD.requires_approval)
BEGIN SELECT RAISE(ABORT, 'invalid tool call mutation'); END;
CREATE TABLE viper_engine.tool_call_attempts (
  run_id TEXT NOT NULL, tool_call_id TEXT NOT NULL, attempt INTEGER NOT NULL CHECK (attempt >= 1),
  actor_id TEXT NOT NULL, app_id TEXT NOT NULL, tenant_key TEXT NOT NULL,
  worker_id TEXT CHECK (length(worker_id) BETWEEN 1 AND 128), lease_fence INTEGER CHECK (lease_fence >= 1),
  dispatched_at_ms INTEGER NOT NULL, settled_at_ms INTEGER CHECK (settled_at_ms >= dispatched_at_ms),
  result_kind TEXT CHECK (result_kind IN ('succeeded','failed','unknown','retry_wait')),
  CHECK ((settled_at_ms IS NULL) = (result_kind IS NULL)),
  CHECK ((worker_id IS NULL) = (lease_fence IS NULL)),
  PRIMARY KEY (run_id, tool_call_id, attempt),
  FOREIGN KEY (run_id, tool_call_id, actor_id, app_id, tenant_key)
    REFERENCES tool_calls(run_id, id, actor_id, app_id, tenant_key)
) STRICT;
CREATE UNIQUE INDEX viper_engine.tool_call_attempts_one_open ON tool_call_attempts (run_id, tool_call_id) WHERE settled_at_ms IS NULL;
CREATE TRIGGER viper_engine.tool_call_attempts_no_delete BEFORE DELETE ON tool_call_attempts
BEGIN SELECT RAISE(ABORT, 'tool attempt cannot be deleted'); END;
CREATE TRIGGER viper_engine.tool_call_attempts_settle_once BEFORE UPDATE ON tool_call_attempts
WHEN OLD.settled_at_ms IS NOT NULL
  OR (NEW.run_id, NEW.tool_call_id, NEW.attempt, NEW.actor_id, NEW.app_id, NEW.tenant_key,
      NEW.worker_id, NEW.lease_fence, NEW.dispatched_at_ms)
  IS NOT (OLD.run_id, OLD.tool_call_id, OLD.attempt, OLD.actor_id, OLD.app_id, OLD.tenant_key,
      OLD.worker_id, OLD.lease_fence, OLD.dispatched_at_ms)
BEGIN SELECT RAISE(ABORT, 'invalid tool attempt mutation'); END;
`;
