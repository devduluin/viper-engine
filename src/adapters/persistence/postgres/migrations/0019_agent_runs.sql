-- Sub-agent foundation (PLAN-SUBAGENTS P0). A child is an ordinary durable run with lineage columns; relations
-- between runs live in run_links so later multi-agent kinds (messaged, handoff, observes) need no new schema.
-- A parent waiting for its children is parked in waiting_for_agents: it holds no lease, so a full worker pool
-- of waiting parents cannot starve the children they wait for.
ALTER TABLE viper_engine.runs DROP CONSTRAINT runs_status_check;
ALTER TABLE viper_engine.runs ADD CONSTRAINT runs_status_check CHECK (status IN ('queued', 'running',
  'waiting_for_input', 'waiting_for_approval', 'waiting_for_agents', 'completed', 'partial', 'failed', 'cancelled'));

ALTER TABLE viper_engine.runs
  ADD COLUMN parent_run_id viper_engine.entity_id NULL,
  ADD COLUMN root_run_id viper_engine.entity_id NULL,
  ADD COLUMN depth smallint NOT NULL DEFAULT 0 CONSTRAINT runs_depth_bounded CHECK (depth BETWEEN 0 AND 8),
  ADD COLUMN agent_profile text NULL CONSTRAINT runs_agent_profile_name CHECK (agent_profile ~ '^[a-z][a-z0-9_-]{0,63}$'),
  ADD COLUMN spawn_key text NULL CONSTRAINT runs_spawn_key_bounded CHECK (length(spawn_key) BETWEEN 1 AND 64);
-- Lineage is all-or-nothing: a root has none of it, a child has parent, root and a positive depth.
ALTER TABLE viper_engine.runs ADD CONSTRAINT runs_lineage_shape CHECK (
  (parent_run_id IS NULL AND root_run_id IS NULL AND depth = 0 AND spawn_key IS NULL)
  OR (parent_run_id IS NOT NULL AND root_run_id IS NOT NULL AND depth >= 1 AND spawn_key IS NOT NULL));
-- A child belongs to the parent's owner; the composite key makes a cross-owner parent impossible.
ALTER TABLE viper_engine.runs ADD CONSTRAINT runs_parent_fk FOREIGN KEY (parent_run_id, actor_id, app_id, tenant_key)
  REFERENCES viper_engine.runs (id, actor_id, app_id, tenant_key);
ALTER TABLE viper_engine.runs ADD CONSTRAINT runs_root_fk FOREIGN KEY (root_run_id, actor_id, app_id, tenant_key)
  REFERENCES viper_engine.runs (id, actor_id, app_id, tenant_key);
CREATE UNIQUE INDEX runs_spawn_once ON viper_engine.runs (parent_run_id, spawn_key) WHERE parent_run_id IS NOT NULL;
CREATE INDEX runs_tree ON viper_engine.runs (root_run_id, status) WHERE root_run_id IS NOT NULL;

CREATE FUNCTION viper_engine.run_lineage_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.parent_run_id, NEW.root_run_id, NEW.depth, NEW.agent_profile, NEW.spawn_key)
    IS DISTINCT FROM (OLD.parent_run_id, OLD.root_run_id, OLD.depth, OLD.agent_profile, OLD.spawn_key) THEN
    RAISE EXCEPTION 'Run lineage is immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER run_lineage_fixed BEFORE UPDATE ON viper_engine.runs
  FOR EACH ROW EXECUTE FUNCTION viper_engine.run_lineage_fixed();

CREATE TABLE viper_engine.run_links (
  id viper_engine.entity_id PRIMARY KEY,
  from_run_id viper_engine.entity_id NOT NULL,
  to_run_id viper_engine.entity_id NOT NULL,
  actor_id viper_engine.entity_id NOT NULL,
  app_id viper_engine.entity_id NOT NULL,
  tenant_key viper_engine.tenant_key,
  kind text NOT NULL CONSTRAINT run_links_kind CHECK (kind IN ('spawned', 'awaits', 'messaged', 'handoff', 'observes')),
  metadata jsonb NOT NULL DEFAULT '{}'
    CONSTRAINT run_links_metadata_bounded CHECK (jsonb_typeof(metadata) = 'object' AND pg_column_size(metadata) <= 4096),
  created_at timestamptz NOT NULL,
  -- Only awaits links are satisfied; they stay as audit rows instead of being deleted.
  satisfied_at timestamptz NULL CONSTRAINT run_links_satisfied_awaits CHECK (satisfied_at IS NULL OR kind = 'awaits'),
  CONSTRAINT run_links_distinct CHECK (from_run_id <> to_run_id),
  CONSTRAINT run_links_from_fk FOREIGN KEY (from_run_id, actor_id, app_id, tenant_key)
    REFERENCES viper_engine.runs (id, actor_id, app_id, tenant_key),
  CONSTRAINT run_links_to_fk FOREIGN KEY (to_run_id, actor_id, app_id, tenant_key)
    REFERENCES viper_engine.runs (id, actor_id, app_id, tenant_key)
);
CREATE UNIQUE INDEX run_links_once ON viper_engine.run_links (from_run_id, to_run_id, kind);
CREATE INDEX run_links_to ON viper_engine.run_links (to_run_id, kind);
CREATE INDEX run_links_open_awaits ON viper_engine.run_links (from_run_id) WHERE kind = 'awaits' AND satisfied_at IS NULL;

CREATE FUNCTION viper_engine.run_link_settle_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.satisfied_at IS NOT NULL OR NEW.satisfied_at IS NULL
    OR (NEW.id, NEW.from_run_id, NEW.to_run_id, NEW.actor_id, NEW.app_id, NEW.tenant_key, NEW.kind, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.from_run_id, OLD.to_run_id, OLD.actor_id, OLD.app_id, OLD.tenant_key, OLD.kind, OLD.created_at)
    OR NEW.metadata IS DISTINCT FROM OLD.metadata THEN
    RAISE EXCEPTION 'Run link is satisfied once and is otherwise immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER run_link_settle_once BEFORE UPDATE ON viper_engine.run_links
  FOR EACH ROW EXECUTE FUNCTION viper_engine.run_link_settle_once();

-- Child conversations hold a sub-agent's brief and transcript; they are hidden from the user's history list.
ALTER TABLE viper_engine.conversations
  ADD COLUMN kind text NOT NULL DEFAULT 'chat' CONSTRAINT conversations_kind CHECK (kind IN ('chat', 'agent')),
  ADD COLUMN parent_conversation_id viper_engine.entity_id NULL;
ALTER TABLE viper_engine.conversations ADD CONSTRAINT conversations_parent_shape
  CHECK ((kind = 'agent') = (parent_conversation_id IS NOT NULL));
ALTER TABLE viper_engine.conversations ADD CONSTRAINT conversations_parent_fk
  FOREIGN KEY (parent_conversation_id, actor_id, app_id, tenant_key)
  REFERENCES viper_engine.conversations (id, actor_id, app_id, tenant_key);

ALTER TABLE viper_engine.run_events DROP CONSTRAINT run_events_type_check;
ALTER TABLE viper_engine.run_events ADD CONSTRAINT run_events_type_check CHECK (type IN ('run.queued', 'run.started',
  'step.started', 'tool.started', 'tool.completed', 'tool.failed', 'run.input_required', 'approval.required',
  'message.completed', 'run.completed', 'run.partial', 'run.failed', 'run.cancelled',
  'agent.spawned', 'agent.completed', 'agent.approval_required'));

CREATE TRIGGER run_links_no_delete BEFORE DELETE ON viper_engine.run_links
  FOR EACH ROW EXECUTE FUNCTION viper_engine.reject_update();
CREATE FUNCTION viper_engine.conversation_parent_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.kind, NEW.parent_conversation_id) IS DISTINCT FROM (OLD.kind, OLD.parent_conversation_id) THEN
    RAISE EXCEPTION 'Conversation kind and parent are immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER conversation_parent_fixed BEFORE UPDATE ON viper_engine.conversations
  FOR EACH ROW EXECUTE FUNCTION viper_engine.conversation_parent_fixed();
