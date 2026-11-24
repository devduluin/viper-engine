/**
 * Sub-agent foundation (PLAN-SUBAGENTS P0), the SQLite twin of postgres 0019_agent_runs.sql.
 * SQLite cannot alter a CHECK, so runs is rebuilt. The migration runner applies it with foreign keys off and
 * runs foreign_key_check before commit (the documented table-rebuild procedure). legacy_alter_table keeps the
 * rename from rewriting triggers of other tables, which name `runs` and must keep doing so.
 */
const RUNS_COLUMNS = `id, actor_id, app_id, tenant_key, conversation_id, status, revision, created_at_ms, updated_at_ms,
  cancel_requested_at_ms, last_event_sequence, lease_fence, lease_owner, lease_expires_at_ms, effort, client_tools`;

const RUNS_REBUILD = `
PRAGMA legacy_alter_table = ON;
CREATE TABLE viper_engine.runs_next (
  id TEXT PRIMARY KEY NOT NULL,
  actor_id TEXT NOT NULL, app_id TEXT NOT NULL, tenant_key TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','waiting_for_input','waiting_for_approval','waiting_for_agents','completed','partial','failed','cancelled')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL, cancel_requested_at_ms INTEGER,
  last_event_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_event_sequence >= 0),
  lease_fence INTEGER NOT NULL DEFAULT 0 CHECK (lease_fence >= 0),
  lease_owner TEXT, lease_expires_at_ms INTEGER,
  effort TEXT CHECK (effort IN ('low','medium','high')),
  client_tools TEXT CHECK (json_valid(client_tools) AND json_type(client_tools) = 'array'),
  parent_run_id TEXT, root_run_id TEXT,
  depth INTEGER NOT NULL DEFAULT 0 CHECK (depth BETWEEN 0 AND 8),
  agent_profile TEXT CHECK (length(agent_profile) BETWEEN 1 AND 64 AND agent_profile NOT GLOB '*[^a-z0-9_-]*' AND substr(agent_profile, 1, 1) GLOB '[a-z]'),
  spawn_key TEXT CHECK (length(spawn_key) BETWEEN 1 AND 64),
  CHECK ((lease_owner IS NULL) = (lease_expires_at_ms IS NULL)),
  CHECK ((parent_run_id IS NULL AND root_run_id IS NULL AND depth = 0 AND spawn_key IS NULL)
    OR (parent_run_id IS NOT NULL AND root_run_id IS NOT NULL AND depth >= 1 AND spawn_key IS NOT NULL)),
  UNIQUE (id, actor_id, app_id, tenant_key),
  UNIQUE (id, conversation_id, actor_id, app_id, tenant_key),
  FOREIGN KEY (conversation_id, actor_id, app_id, tenant_key) REFERENCES conversations (id, actor_id, app_id, tenant_key),
  FOREIGN KEY (parent_run_id, actor_id, app_id, tenant_key) REFERENCES runs (id, actor_id, app_id, tenant_key),
  FOREIGN KEY (root_run_id, actor_id, app_id, tenant_key) REFERENCES runs (id, actor_id, app_id, tenant_key)
) STRICT;
INSERT INTO viper_engine.runs_next (${RUNS_COLUMNS}) SELECT ${RUNS_COLUMNS} FROM viper_engine.runs;
DROP TABLE viper_engine.runs;
ALTER TABLE viper_engine.runs_next RENAME TO runs;
PRAGMA legacy_alter_table = OFF;
CREATE INDEX viper_engine.runs_conversation_recent ON runs (conversation_id, created_at_ms DESC, id DESC);
CREATE UNIQUE INDEX viper_engine.runs_spawn_once ON runs (parent_run_id, spawn_key) WHERE parent_run_id IS NOT NULL;
CREATE INDEX viper_engine.runs_tree ON runs (root_run_id, status) WHERE root_run_id IS NOT NULL;
CREATE TRIGGER viper_engine.run_revision_step BEFORE UPDATE OF revision ON runs
WHEN NEW.revision <> OLD.revision + 1 BEGIN SELECT RAISE(ABORT, 'run revision must increase by one'); END;
CREATE TRIGGER viper_engine.run_owner_fixed BEFORE UPDATE ON runs
WHEN (NEW.actor_id, NEW.app_id, NEW.tenant_key) IS NOT (OLD.actor_id, OLD.app_id, OLD.tenant_key)
BEGIN SELECT RAISE(ABORT, 'run owner is immutable'); END;
CREATE TRIGGER viper_engine.run_fence_monotonic BEFORE UPDATE OF lease_fence ON runs
WHEN NEW.lease_fence < OLD.lease_fence BEGIN SELECT RAISE(ABORT, 'lease fence cannot decrease'); END;
CREATE TRIGGER viper_engine.run_lineage_fixed BEFORE UPDATE ON runs
WHEN (NEW.parent_run_id, NEW.root_run_id, NEW.depth, NEW.agent_profile, NEW.spawn_key)
  IS NOT (OLD.parent_run_id, OLD.root_run_id, OLD.depth, OLD.agent_profile, OLD.spawn_key)
BEGIN SELECT RAISE(ABORT, 'run lineage is immutable'); END;
`;

const RUN_LINKS = `
CREATE TABLE viper_engine.run_links (
  id TEXT PRIMARY KEY NOT NULL,
  from_run_id TEXT NOT NULL, to_run_id TEXT NOT NULL,
  actor_id TEXT NOT NULL, app_id TEXT NOT NULL, tenant_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('spawned','awaits','messaged','handoff','observes')),
  metadata TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata) AND json_type(metadata) = 'object' AND length(metadata) <= 4096),
  created_at_ms INTEGER NOT NULL,
  satisfied_at_ms INTEGER CHECK (satisfied_at_ms IS NULL OR kind = 'awaits'),
  CHECK (from_run_id <> to_run_id),
  FOREIGN KEY (from_run_id, actor_id, app_id, tenant_key) REFERENCES runs (id, actor_id, app_id, tenant_key),
  FOREIGN KEY (to_run_id, actor_id, app_id, tenant_key) REFERENCES runs (id, actor_id, app_id, tenant_key)
) STRICT;
CREATE UNIQUE INDEX viper_engine.run_links_once ON run_links (from_run_id, to_run_id, kind);
CREATE INDEX viper_engine.run_links_to ON run_links (to_run_id, kind);
CREATE INDEX viper_engine.run_links_open_awaits ON run_links (from_run_id) WHERE kind = 'awaits' AND satisfied_at_ms IS NULL;
CREATE TRIGGER viper_engine.run_link_settle_once BEFORE UPDATE ON run_links
WHEN OLD.satisfied_at_ms IS NOT NULL OR NEW.satisfied_at_ms IS NULL
  OR (NEW.id, NEW.from_run_id, NEW.to_run_id, NEW.actor_id, NEW.app_id, NEW.tenant_key, NEW.kind, NEW.metadata, NEW.created_at_ms)
    IS NOT (OLD.id, OLD.from_run_id, OLD.to_run_id, OLD.actor_id, OLD.app_id, OLD.tenant_key, OLD.kind, OLD.metadata, OLD.created_at_ms)
BEGIN SELECT RAISE(ABORT, 'run link is satisfied once and is otherwise immutable'); END;
CREATE TRIGGER viper_engine.run_link_no_delete BEFORE DELETE ON run_links
BEGIN SELECT RAISE(ABORT, 'run link is immutable'); END;
`;

const AGENT_CONVERSATIONS = `
ALTER TABLE viper_engine.conversations ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat' CHECK (kind IN ('chat','agent'));
ALTER TABLE viper_engine.conversations ADD COLUMN parent_conversation_id TEXT;
CREATE TRIGGER viper_engine.conversation_parent_shape BEFORE INSERT ON conversations
WHEN (NEW.kind = 'agent') <> (NEW.parent_conversation_id IS NOT NULL)
  OR (NEW.parent_conversation_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM conversations p WHERE p.id = NEW.parent_conversation_id
    AND (p.actor_id, p.app_id, p.tenant_key) IS (NEW.actor_id, NEW.app_id, NEW.tenant_key)))
BEGIN SELECT RAISE(ABORT, 'agent conversation needs a parent of the same owner'); END;
CREATE TRIGGER viper_engine.conversation_parent_fixed BEFORE UPDATE ON conversations
WHEN (NEW.kind, NEW.parent_conversation_id) IS NOT (OLD.kind, OLD.parent_conversation_id)
BEGIN SELECT RAISE(ABORT, 'conversation kind and parent are immutable'); END;
`;

export const AGENT_RUNS_SCHEMA = RUNS_REBUILD + RUN_LINKS + AGENT_CONVERSATIONS;

/** Twin of postgres 0020_agent_settlement.sql: settle awaits, wake a parked parent, cancel orphaned children. */
export const AGENT_SETTLEMENT_SCHEMA = `
CREATE TRIGGER viper_engine.settle_agent_runs AFTER UPDATE OF status ON runs
WHEN NEW.status IN ('completed','partial','failed','cancelled') AND OLD.status <> NEW.status
BEGIN
  UPDATE run_links SET satisfied_at_ms = NEW.updated_at_ms
    WHERE to_run_id = NEW.id AND kind = 'awaits' AND satisfied_at_ms IS NULL;
  UPDATE runs SET status = 'running', revision = revision + 1, updated_at_ms = NEW.updated_at_ms,
      lease_owner = NULL, lease_expires_at_ms = NULL, lease_fence = lease_fence + 1
    WHERE id = NEW.parent_run_id AND status = 'waiting_for_agents'
      AND NOT EXISTS (SELECT 1 FROM run_links l WHERE l.from_run_id = runs.id AND l.kind = 'awaits' AND l.satisfied_at_ms IS NULL);
  UPDATE runs SET cancel_requested_at_ms = NEW.updated_at_ms, revision = revision + 1, updated_at_ms = NEW.updated_at_ms
    WHERE parent_run_id = NEW.id AND cancel_requested_at_ms IS NULL
      AND status NOT IN ('completed','partial','failed','cancelled');
END;
`;
