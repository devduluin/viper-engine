-- Viper engine execution ledger, approvals, events and idempotency, P04-01.
-- Rules mirror src/contracts/state and docs/schema/state-transitions.md.

CREATE TABLE viper_engine.tool_calls (
  run_id viper_engine.entity_id NOT NULL,
  id viper_engine.entity_id NOT NULL,
  actor_id viper_engine.entity_id NOT NULL,
  app_id viper_engine.entity_id NOT NULL,
  tenant_key viper_engine.tenant_key,
  step_id viper_engine.entity_id NOT NULL,
  status text NOT NULL CHECK (status IN ('proposed', 'awaiting_approval', 'ready', 'dispatching', 'retry_wait',
    'succeeded', 'failed', 'unknown', 'rejected', 'cancelled')),
  revision viper_engine.revision DEFAULT 1,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  connection_id viper_engine.entity_id NOT NULL,
  server_id viper_engine.entity_id NOT NULL,
  tool_name text NOT NULL CHECK (length(btrim(tool_name)) BETWEEN 1 AND 256),
  definition_version text NOT NULL CHECK (length(btrim(definition_version)) BETWEEN 1 AND 256),
  -- Optional audit copies; the digest is the binding. The port carries them when available.
  schema_snapshot jsonb NULL CHECK (jsonb_typeof(schema_snapshot) = 'object' AND pg_column_size(schema_snapshot) <= 131072),
  arguments jsonb NULL CHECK (jsonb_typeof(arguments) = 'object' AND pg_column_size(arguments) <= 262144),
  arguments_digest viper_engine.sha256_hex NOT NULL,
  requires_approval boolean NOT NULL,
  outcome jsonb NULL CHECK (jsonb_typeof(outcome) = 'object' AND pg_column_size(outcome) <= 262144),
  evidence jsonb NULL CHECK (jsonb_typeof(evidence) = 'object' AND pg_column_size(evidence) <= 16384),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, id),
  -- Every state that is reachable only through dispatching has at least one attempt.
  CHECK (attempts >= 1 OR status IN ('proposed', 'awaiting_approval', 'ready', 'rejected', 'cancelled')),
  UNIQUE (run_id, id, actor_id, app_id, tenant_key),
  UNIQUE (run_id, id, connection_id, server_id, tool_name, definition_version, arguments_digest,
    actor_id, app_id, tenant_key),
  FOREIGN KEY (run_id, actor_id, app_id, tenant_key) REFERENCES viper_engine.runs (id, actor_id, app_id, tenant_key),
  -- step_id is a correlation ID; step rows are persisted by the checkpoint work (P04-04).
  -- The caller's own live-or-revoked connection to exactly this server.
  FOREIGN KEY (connection_id, server_id, actor_id, app_id, tenant_key)
    REFERENCES viper_engine.mcp_connections (id, server_id, actor_id, app_id, tenant_key)
);
CREATE INDEX tool_calls_run_status ON viper_engine.tool_calls (run_id, status);

CREATE FUNCTION viper_engine.guard_tool_call_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.step_id, NEW.connection_id, NEW.server_id, NEW.tool_name, NEW.definition_version,
      NEW.schema_snapshot, NEW.arguments, NEW.arguments_digest, NEW.requires_approval)
     IS DISTINCT FROM (OLD.step_id, OLD.connection_id, OLD.server_id, OLD.tool_name, OLD.definition_version,
      OLD.schema_snapshot, OLD.arguments, OLD.arguments_digest, OLD.requires_approval) THEN
    RAISE EXCEPTION 'tool call identity, arguments and approval requirement are immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.attempts < OLD.attempts THEN
    RAISE EXCEPTION 'tool call attempts cannot decrease' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TABLE viper_engine.approvals (
  id viper_engine.entity_id PRIMARY KEY,
  actor_id viper_engine.entity_id NOT NULL,
  app_id viper_engine.entity_id NOT NULL,
  tenant_key viper_engine.tenant_key,
  run_id viper_engine.entity_id NOT NULL,
  tool_call_id viper_engine.entity_id NOT NULL,
  connection_id viper_engine.entity_id NOT NULL,
  server_id viper_engine.entity_id NOT NULL,
  tool_name text NOT NULL,
  definition_version text NOT NULL,
  arguments_digest viper_engine.sha256_hex NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'expired', 'superseded', 'consumed')),
  revision viper_engine.revision DEFAULT 1,
  expires_at timestamptz NOT NULL,
  decided_at timestamptz NULL,
  consumed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK ((status = 'consumed') = (consumed_at IS NOT NULL)),
  CHECK (status NOT IN ('accepted', 'rejected', 'consumed') OR decided_at IS NOT NULL),
  -- The binding must equal the tool call it approves, owner included.
  FOREIGN KEY (run_id, tool_call_id, connection_id, server_id, tool_name, definition_version, arguments_digest,
    actor_id, app_id, tenant_key)
    REFERENCES viper_engine.tool_calls (run_id, id, connection_id, server_id, tool_name, definition_version,
      arguments_digest, actor_id, app_id, tenant_key)
);
CREATE UNIQUE INDEX approvals_one_live ON viper_engine.approvals (run_id, tool_call_id)
  WHERE status IN ('pending', 'accepted');

CREATE FUNCTION viper_engine.guard_approval_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.run_id, NEW.tool_call_id, NEW.connection_id, NEW.server_id, NEW.tool_name,
      NEW.definition_version, NEW.arguments_digest, NEW.expires_at, NEW.created_at)
     IS DISTINCT FROM (OLD.run_id, OLD.tool_call_id, OLD.connection_id, OLD.server_id, OLD.tool_name,
      OLD.definition_version, OLD.arguments_digest, OLD.expires_at, OLD.created_at) THEN
    RAISE EXCEPTION 'approval binding is immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TABLE viper_engine.run_events (
  run_id viper_engine.entity_id NOT NULL,
  sequence bigint NOT NULL CHECK (sequence >= 1),
  event_id viper_engine.entity_id NOT NULL UNIQUE,
  actor_id viper_engine.entity_id NOT NULL,
  app_id viper_engine.entity_id NOT NULL,
  tenant_key viper_engine.tenant_key,
  conversation_id viper_engine.entity_id NOT NULL,
  type text NOT NULL CHECK (type IN ('run.queued', 'run.started', 'step.started', 'tool.started', 'tool.completed',
    'tool.failed', 'run.input_required', 'approval.required', 'message.completed',
    'run.completed', 'run.partial', 'run.failed', 'run.cancelled')),
  step_id viper_engine.entity_id NULL,
  model_call_id viper_engine.entity_id NULL,
  tool_call_id viper_engine.entity_id NULL,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(payload) = 'object' AND pg_column_size(payload) <= 65536),
  PRIMARY KEY (run_id, sequence),
  FOREIGN KEY (run_id, conversation_id, actor_id, app_id, tenant_key)
    REFERENCES viper_engine.runs (id, conversation_id, actor_id, app_id, tenant_key)
);
CREATE INDEX run_events_retention ON viper_engine.run_events (occurred_at);

-- Gap-free append-only log: a new event must directly follow the run's last event.
CREATE FUNCTION viper_engine.guard_run_event_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous bigint;
BEGIN
  SELECT max(sequence) INTO previous FROM viper_engine.run_events WHERE run_id = NEW.run_id;
  IF NEW.sequence <> coalesce(previous, 0) + 1 THEN
    RAISE EXCEPTION 'run event sequence gap (% after %)', NEW.sequence, coalesce(previous, 0)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION viper_engine.reject_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END $$;

CREATE TABLE viper_engine.request_idempotency (
  actor_id viper_engine.entity_id NOT NULL,
  app_id viper_engine.entity_id NOT NULL,
  tenant_key viper_engine.tenant_key,
  operation text NOT NULL CHECK (operation ~ '^[a-z][a-z0-9_.]{0,63}$'),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 256),
  payload_fingerprint viper_engine.sha256_hex NOT NULL,
  resource_ref text NULL CHECK (length(resource_ref) BETWEEN 1 AND 512),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  CHECK (expires_at > created_at),
  PRIMARY KEY (actor_id, app_id, tenant_key, operation, idempotency_key)
);
CREATE INDEX request_idempotency_expiry ON viper_engine.request_idempotency (expires_at);

-- Triggers ------------------------------------------------------------------------------
CREATE TRIGGER revision_step BEFORE UPDATE OF revision ON viper_engine.mcp_servers
  FOR EACH ROW EXECUTE FUNCTION viper_engine.enforce_revision_step();
CREATE TRIGGER revision_step BEFORE UPDATE OF revision ON viper_engine.mcp_connections
  FOR EACH ROW EXECUTE FUNCTION viper_engine.enforce_revision_step();
CREATE TRIGGER revision_step BEFORE UPDATE OF revision ON viper_engine.conversations
  FOR EACH ROW EXECUTE FUNCTION viper_engine.enforce_revision_step();
CREATE TRIGGER revision_step BEFORE UPDATE OF revision ON viper_engine.runs
  FOR EACH ROW EXECUTE FUNCTION viper_engine.enforce_revision_step();
CREATE TRIGGER revision_step BEFORE UPDATE OF revision ON viper_engine.tool_calls
  FOR EACH ROW EXECUTE FUNCTION viper_engine.enforce_revision_step();
CREATE TRIGGER revision_step BEFORE UPDATE OF revision ON viper_engine.approvals
  FOR EACH ROW EXECUTE FUNCTION viper_engine.enforce_revision_step();
CREATE TRIGGER owner_fixed BEFORE UPDATE ON viper_engine.mcp_connections
  FOR EACH ROW EXECUTE FUNCTION viper_engine.reject_owner_change();
CREATE TRIGGER owner_fixed BEFORE UPDATE ON viper_engine.conversations
  FOR EACH ROW EXECUTE FUNCTION viper_engine.reject_owner_change();
CREATE TRIGGER owner_fixed BEFORE UPDATE ON viper_engine.runs
  FOR EACH ROW EXECUTE FUNCTION viper_engine.reject_owner_change();
CREATE TRIGGER owner_fixed BEFORE UPDATE ON viper_engine.tool_calls
  FOR EACH ROW EXECUTE FUNCTION viper_engine.reject_owner_change();
CREATE TRIGGER owner_fixed BEFORE UPDATE ON viper_engine.approvals
  FOR EACH ROW EXECUTE FUNCTION viper_engine.reject_owner_change();
CREATE TRIGGER immutable_call BEFORE UPDATE ON viper_engine.tool_calls
  FOR EACH ROW EXECUTE FUNCTION viper_engine.guard_tool_call_update();
CREATE TRIGGER immutable_binding BEFORE UPDATE ON viper_engine.approvals
  FOR EACH ROW EXECUTE FUNCTION viper_engine.guard_approval_update();
CREATE TRIGGER gap_free BEFORE INSERT ON viper_engine.run_events
  FOR EACH ROW EXECUTE FUNCTION viper_engine.guard_run_event_insert();
CREATE TRIGGER append_only BEFORE UPDATE ON viper_engine.run_events
  FOR EACH ROW EXECUTE FUNCTION viper_engine.reject_update();
CREATE TRIGGER append_only BEFORE UPDATE ON viper_engine.messages
  FOR EACH ROW EXECUTE FUNCTION viper_engine.reject_update();
