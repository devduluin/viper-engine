-- Viper engine fresh schema, P04-01. Blueprint: docs/schema/tables.md, ADR-0001.
-- New schema only: no V4 tables, IDs or foreign keys. The migration runner creates the empty
-- `viper_engine` schema and its `schema_migrations` table before applying this file.

CREATE DOMAIN viper_engine.entity_id AS text
  CHECK (length(VALUE) BETWEEN 1 AND 256 AND VALUE !~ '[[:space:][:cntrl:]]');
-- '' marks a tenant-less deployment, so unique constraints never rely on NULL semantics.
CREATE DOMAIN viper_engine.tenant_key AS text NOT NULL
  CHECK (length(VALUE) <= 256 AND VALUE !~ '[[:space:][:cntrl:]]');
CREATE DOMAIN viper_engine.revision AS bigint NOT NULL CHECK (VALUE >= 1);
CREATE DOMAIN viper_engine.sha256_hex AS char(64) CHECK (VALUE ~ '^[0-9a-f]{64}$');

-- Shared guards -------------------------------------------------------------------------
CREATE FUNCTION viper_engine.enforce_revision_step() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'revision must increase by exactly 1 (% -> %)', OLD.revision, NEW.revision
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION viper_engine.reject_owner_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.actor_id, NEW.app_id, NEW.tenant_key) IS DISTINCT FROM (OLD.actor_id, OLD.app_id, OLD.tenant_key) THEN
    RAISE EXCEPTION 'owner columns are immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- MCP configuration ---------------------------------------------------------------------
CREATE TABLE viper_engine.mcp_servers (
  id viper_engine.entity_id PRIMARY KEY,
  app_id viper_engine.entity_id NOT NULL,
  tenant_key viper_engine.tenant_key,
  owner_actor_id viper_engine.entity_id NULL, -- NULL: app-level definition
  transport text NOT NULL CHECK (transport IN ('streamable_http', 'stdio')),
  endpoint_ref text NOT NULL CHECK (length(endpoint_ref) BETWEEN 1 AND 2048),
  config jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(config) = 'object' AND pg_column_size(config) <= 65536),
  enabled boolean NOT NULL DEFAULT true,
  revision viper_engine.revision DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, app_id, tenant_key)
);

CREATE TABLE viper_engine.mcp_connections (
  id viper_engine.entity_id PRIMARY KEY,
  actor_id viper_engine.entity_id NOT NULL,
  app_id viper_engine.entity_id NOT NULL,
  tenant_key viper_engine.tenant_key,
  server_id viper_engine.entity_id NOT NULL,
  auth_state text NOT NULL CHECK (auth_state IN ('ready', 'authentication_required', 'revoked')),
  secret_ref text NULL CHECK (length(secret_ref) BETWEEN 1 AND 512), -- credential-port reference only
  granted_capabilities jsonb NOT NULL DEFAULT '{}'
    CHECK (jsonb_typeof(granted_capabilities) = 'object' AND pg_column_size(granted_capabilities) <= 16384),
  revoked_at timestamptz NULL,
  revision viper_engine.revision DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((auth_state = 'revoked') = (revoked_at IS NOT NULL)),
  UNIQUE (id, server_id, actor_id, app_id, tenant_key),
  FOREIGN KEY (server_id, app_id, tenant_key) REFERENCES viper_engine.mcp_servers (id, app_id, tenant_key)
);
CREATE UNIQUE INDEX mcp_connections_live_binding ON viper_engine.mcp_connections
  (server_id, actor_id, app_id, tenant_key) WHERE revoked_at IS NULL;

-- Conversations and runs ----------------------------------------------------------------
CREATE TABLE viper_engine.conversations (
  id viper_engine.entity_id PRIMARY KEY,
  actor_id viper_engine.entity_id NOT NULL,
  app_id viper_engine.entity_id NOT NULL,
  tenant_key viper_engine.tenant_key,
  title text NULL CHECK (length(title) BETWEEN 1 AND 500),
  next_message_position bigint NOT NULL DEFAULT 0 CHECK (next_message_position >= 0),
  revision viper_engine.revision DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, actor_id, app_id, tenant_key)
);
CREATE INDEX conversations_owner_recent ON viper_engine.conversations (actor_id, app_id, tenant_key, updated_at DESC);

CREATE TABLE viper_engine.runs (
  id viper_engine.entity_id PRIMARY KEY,
  actor_id viper_engine.entity_id NOT NULL,
  app_id viper_engine.entity_id NOT NULL,
  tenant_key viper_engine.tenant_key,
  conversation_id viper_engine.entity_id NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'waiting_for_input', 'waiting_for_approval',
    'completed', 'partial', 'failed', 'cancelled')),
  revision viper_engine.revision DEFAULT 1,
  cancel_requested_at timestamptz NULL,
  last_event_sequence bigint NOT NULL DEFAULT 0 CHECK (last_event_sequence >= 0),
  lease_owner text NULL CHECK (length(lease_owner) BETWEEN 1 AND 256), -- P04-02
  lease_expires_at timestamptz NULL,
  lease_fence bigint NOT NULL DEFAULT 0 CHECK (lease_fence >= 0),
  budget jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(budget) = 'object' AND pg_column_size(budget) <= 8192),
  checkpoint_ref text NULL CHECK (length(checkpoint_ref) BETWEEN 1 AND 512),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL)),
  UNIQUE (id, actor_id, app_id, tenant_key),
  UNIQUE (id, conversation_id, actor_id, app_id, tenant_key),
  FOREIGN KEY (conversation_id, actor_id, app_id, tenant_key)
    REFERENCES viper_engine.conversations (id, actor_id, app_id, tenant_key)
);
CREATE INDEX runs_conversation ON viper_engine.runs (conversation_id, created_at);
CREATE INDEX runs_claimable ON viper_engine.runs (lease_expires_at) WHERE status IN ('queued', 'running');

CREATE TABLE viper_engine.run_steps (
  run_id viper_engine.entity_id NOT NULL,
  step_index integer NOT NULL CHECK (step_index >= 1),
  id viper_engine.entity_id NOT NULL UNIQUE,
  actor_id viper_engine.entity_id NOT NULL,
  app_id viper_engine.entity_id NOT NULL,
  tenant_key viper_engine.tenant_key,
  decision_kind text NULL CHECK (decision_kind IN ('final', 'tool_calls', 'needs_input')),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz NULL CHECK (ended_at >= started_at),
  PRIMARY KEY (run_id, step_index),
  UNIQUE (run_id, id),
  FOREIGN KEY (run_id, actor_id, app_id, tenant_key) REFERENCES viper_engine.runs (id, actor_id, app_id, tenant_key)
);

CREATE TABLE viper_engine.model_calls (
  id viper_engine.entity_id PRIMARY KEY,
  run_id viper_engine.entity_id NOT NULL,
  step_id viper_engine.entity_id NOT NULL,
  actor_id viper_engine.entity_id NOT NULL,
  app_id viper_engine.entity_id NOT NULL,
  tenant_key viper_engine.tenant_key,
  attempt integer NOT NULL CHECK (attempt >= 1),
  provider text NOT NULL CHECK (length(provider) BETWEEN 1 AND 128),
  model text NOT NULL CHECK (length(model) BETWEEN 1 AND 256),
  usage_source text NOT NULL CHECK (usage_source IN ('provider', 'estimate', 'unavailable')),
  input_tokens bigint NULL CHECK (input_tokens >= 0),
  output_tokens bigint NULL CHECK (output_tokens >= 0),
  total_tokens bigint NULL CHECK (total_tokens >= 0),
  outcome text NOT NULL CHECK (outcome IN ('pending', 'succeeded', 'failed', 'cancelled')),
  failure_code text NULL CHECK (length(failure_code) BETWEEN 1 AND 64),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz NULL CHECK (ended_at >= started_at),
  CHECK (usage_source <> 'unavailable' OR num_nonnulls(input_tokens, output_tokens, total_tokens) = 0),
  CHECK ((outcome = 'failed') = (failure_code IS NOT NULL)),
  UNIQUE (step_id, attempt),
  FOREIGN KEY (run_id, step_id) REFERENCES viper_engine.run_steps (run_id, id),
  FOREIGN KEY (run_id, actor_id, app_id, tenant_key) REFERENCES viper_engine.runs (id, actor_id, app_id, tenant_key)
);

CREATE TABLE viper_engine.messages (
  id viper_engine.entity_id PRIMARY KEY,
  actor_id viper_engine.entity_id NOT NULL,
  app_id viper_engine.entity_id NOT NULL,
  tenant_key viper_engine.tenant_key,
  conversation_id viper_engine.entity_id NOT NULL,
  run_id viper_engine.entity_id NULL,
  position bigint NOT NULL CHECK (position >= 1),
  role text NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  content jsonb NOT NULL CHECK (jsonb_typeof(content) = 'array' AND pg_column_size(content) <= 262144),
  tool_calls jsonb NULL CHECK (jsonb_typeof(tool_calls) = 'array' AND pg_column_size(tool_calls) <= 262144),
  tool_call_id viper_engine.entity_id NULL,
  outcome text NULL CHECK (outcome IN ('success', 'error', 'unknown')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((role = 'tool') = (tool_call_id IS NOT NULL) AND (role = 'tool') = (outcome IS NOT NULL)),
  CHECK (tool_calls IS NULL OR role = 'assistant'),
  UNIQUE (conversation_id, position),
  FOREIGN KEY (conversation_id, actor_id, app_id, tenant_key)
    REFERENCES viper_engine.conversations (id, actor_id, app_id, tenant_key),
  FOREIGN KEY (run_id, conversation_id, actor_id, app_id, tenant_key)
    REFERENCES viper_engine.runs (id, conversation_id, actor_id, app_id, tenant_key)
);
-- One result per tool call in a conversation (history validation is conversation-wide).
CREATE UNIQUE INDEX messages_one_tool_result ON viper_engine.messages (conversation_id, tool_call_id) WHERE role = 'tool';
CREATE INDEX messages_run ON viper_engine.messages (run_id) WHERE run_id IS NOT NULL;
