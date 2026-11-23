/** S0 approval schema. Apply after the run and tool schema. */
export const APPROVAL_SPIKE_SCHEMA = `
CREATE TABLE viper_engine.approvals (
  id TEXT PRIMARY KEY NOT NULL, actor_id TEXT NOT NULL, app_id TEXT NOT NULL, tenant_key TEXT NOT NULL,
  run_id TEXT NOT NULL, tool_call_id TEXT NOT NULL, connection_id TEXT NOT NULL, server_id TEXT NOT NULL,
  tool_name TEXT NOT NULL, definition_version TEXT NOT NULL, arguments_digest TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','accepted','rejected','expired','superseded','consumed')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL, expires_at_ms INTEGER NOT NULL,
  decided_at_ms INTEGER, consumed_at_ms INTEGER, decided_by TEXT, superseded_by TEXT REFERENCES approvals(id),
  arguments TEXT NOT NULL CHECK (json_valid(arguments) AND json_type(arguments) = 'object' AND length(CAST(arguments AS BLOB)) <= 262144),
  tool_snapshot TEXT NOT NULL CHECK (json_valid(tool_snapshot) AND json_type(tool_snapshot) = 'object' AND length(CAST(tool_snapshot AS BLOB)) <= 131072),
  CHECK (expires_at_ms > created_at_ms),
  CHECK ((status = 'consumed') = (consumed_at_ms IS NOT NULL)),
  CHECK (status NOT IN ('accepted','rejected','consumed') OR (decided_at_ms IS NOT NULL AND decided_by IS NOT NULL)),
  CHECK (superseded_by IS NULL OR status = 'superseded'),
  FOREIGN KEY (run_id, tool_call_id, connection_id, server_id, tool_name, definition_version, arguments_digest,
    actor_id, app_id, tenant_key) REFERENCES tool_calls (run_id, id, connection_id, server_id, tool_name,
    definition_version, arguments_digest, actor_id, app_id, tenant_key)
) STRICT;
CREATE UNIQUE INDEX viper_engine.approvals_one_live ON approvals (run_id, tool_call_id) WHERE status IN ('pending','accepted');
CREATE INDEX viper_engine.approvals_expiry ON approvals (expires_at_ms) WHERE status IN ('pending','accepted');
CREATE TRIGGER viper_engine.approval_guard BEFORE UPDATE ON approvals
WHEN NEW.revision <> OLD.revision + 1
  OR (NEW.id, NEW.actor_id, NEW.app_id, NEW.tenant_key, NEW.run_id, NEW.tool_call_id, NEW.connection_id, NEW.server_id,
    NEW.tool_name, NEW.definition_version, NEW.arguments_digest, NEW.expires_at_ms, NEW.created_at_ms, NEW.arguments, NEW.tool_snapshot)
  IS NOT (OLD.id, OLD.actor_id, OLD.app_id, OLD.tenant_key, OLD.run_id, OLD.tool_call_id, OLD.connection_id, OLD.server_id,
    OLD.tool_name, OLD.definition_version, OLD.arguments_digest, OLD.expires_at_ms, OLD.created_at_ms, OLD.arguments, OLD.tool_snapshot)
  OR (OLD.decided_by IS NOT NULL AND NEW.decided_by IS NOT OLD.decided_by)
  OR (OLD.superseded_by IS NOT NULL AND NEW.superseded_by IS NOT OLD.superseded_by)
BEGIN SELECT RAISE(ABORT, 'invalid approval mutation'); END;
`;
