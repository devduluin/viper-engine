-- P04-03: durable approval policy. Each proposal stores the exact final arguments and the tool
-- definition shown to the approver, who decided it, and which proposal superseded it.
ALTER TABLE viper_engine.approvals
  ADD COLUMN arguments jsonb NOT NULL DEFAULT '{}'
    CHECK (jsonb_typeof(arguments) = 'object' AND pg_column_size(arguments) <= 262144),
  ADD COLUMN tool_snapshot jsonb NOT NULL DEFAULT '{}'
    CHECK (jsonb_typeof(tool_snapshot) = 'object' AND pg_column_size(tool_snapshot) <= 131072),
  ADD COLUMN decided_by viper_engine.entity_id NULL,
  ADD COLUMN superseded_by viper_engine.entity_id NULL REFERENCES viper_engine.approvals (id),
  ADD CONSTRAINT approvals_decided_by_present
    CHECK (status NOT IN ('accepted', 'rejected', 'consumed') OR decided_by IS NOT NULL),
  ADD CONSTRAINT approvals_superseded_link CHECK (superseded_by IS NULL OR status = 'superseded');
ALTER TABLE viper_engine.approvals ALTER COLUMN arguments DROP DEFAULT, ALTER COLUMN tool_snapshot DROP DEFAULT;

-- Binding and snapshot are immutable; decided_by and superseded_by are written at most once.
CREATE OR REPLACE FUNCTION viper_engine.guard_approval_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.run_id, NEW.tool_call_id, NEW.connection_id, NEW.server_id, NEW.tool_name, NEW.definition_version,
      NEW.arguments_digest, NEW.expires_at, NEW.created_at, NEW.arguments, NEW.tool_snapshot)
     IS DISTINCT FROM (OLD.run_id, OLD.tool_call_id, OLD.connection_id, OLD.server_id, OLD.tool_name,
      OLD.definition_version, OLD.arguments_digest, OLD.expires_at, OLD.created_at, OLD.arguments, OLD.tool_snapshot) THEN
    RAISE EXCEPTION 'approval binding is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF (OLD.decided_by IS NOT NULL AND NEW.decided_by IS DISTINCT FROM OLD.decided_by)
     OR (OLD.superseded_by IS NOT NULL AND NEW.superseded_by IS DISTINCT FROM OLD.superseded_by) THEN
    RAISE EXCEPTION 'approval decision provenance is immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE INDEX approvals_expiry ON viper_engine.approvals (expires_at) WHERE status IN ('pending', 'accepted');
