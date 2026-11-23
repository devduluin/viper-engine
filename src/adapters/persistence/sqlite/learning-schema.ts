export const LEARNING_SCHEMA = `
CREATE TABLE viper_engine.outcome_feedback (
  run_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK (revision >= 1),
  actor_id TEXT NOT NULL, app_id TEXT NOT NULL, tenant_key TEXT NOT NULL,
  conversation_id TEXT NOT NULL, source_message_id TEXT NOT NULL, source_role TEXT NOT NULL DEFAULT 'user' CHECK (source_role = 'user'),
  verdict TEXT NOT NULL CHECK (verdict IN ('confirmed','disputed')), created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (run_id, revision), UNIQUE (run_id, revision, actor_id, app_id, tenant_key),
  FOREIGN KEY (run_id, conversation_id, actor_id, app_id, tenant_key) REFERENCES runs(id, conversation_id, actor_id, app_id, tenant_key),
  FOREIGN KEY (source_message_id, conversation_id, actor_id, app_id, tenant_key, source_role)
    REFERENCES messages(id, conversation_id, actor_id, app_id, tenant_key, role)
) STRICT;
CREATE TABLE viper_engine.memory_proposals (
  id TEXT PRIMARY KEY NOT NULL, actor_id TEXT NOT NULL, app_id TEXT NOT NULL, tenant_key TEXT NOT NULL,
  run_id TEXT NOT NULL, conversation_id TEXT NOT NULL, feedback_revision INTEGER NOT NULL CHECK (feedback_revision >= 1),
  final_message_id TEXT NOT NULL, final_role TEXT NOT NULL DEFAULT 'assistant' CHECK (final_role = 'assistant'),
  candidate_text TEXT NOT NULL CHECK (length(trim(candidate_text)) > 0 AND length(CAST(candidate_text AS BLOB)) <= 8192),
  proposal_digest TEXT NOT NULL CHECK (length(proposal_digest) = 64 AND proposal_digest NOT GLOB '*[^0-9a-f]*'),
  evidence_digest TEXT NOT NULL CHECK (length(evidence_digest) = 64 AND evidence_digest NOT GLOB '*[^0-9a-f]*'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','stale')),
  note_id TEXT UNIQUE, note_revision INTEGER CHECK (note_revision >= 1), confirmation_message_id TEXT,
  confirmation_role TEXT NOT NULL DEFAULT 'user' CHECK (confirmation_role = 'user'),
  created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
  UNIQUE (id, actor_id, app_id, tenant_key), UNIQUE (actor_id, app_id, tenant_key, proposal_digest),
  CHECK ((note_id IS NULL) = (note_revision IS NULL) AND (note_id IS NULL) = (confirmation_message_id IS NULL)),
  CHECK (status <> 'accepted' OR note_id IS NOT NULL),
  FOREIGN KEY (run_id, conversation_id, actor_id, app_id, tenant_key) REFERENCES runs(id, conversation_id, actor_id, app_id, tenant_key),
  FOREIGN KEY (run_id, feedback_revision, actor_id, app_id, tenant_key) REFERENCES outcome_feedback(run_id, revision, actor_id, app_id, tenant_key),
  FOREIGN KEY (final_message_id, conversation_id, actor_id, app_id, tenant_key, final_role)
    REFERENCES messages(id, conversation_id, actor_id, app_id, tenant_key, role),
  FOREIGN KEY (confirmation_message_id, conversation_id, actor_id, app_id, tenant_key, confirmation_role)
    REFERENCES messages(id, conversation_id, actor_id, app_id, tenant_key, role),
  FOREIGN KEY (note_id, actor_id, app_id, tenant_key) REFERENCES memory_notes(id, actor_id, app_id, tenant_key)
) STRICT;
CREATE INDEX viper_engine.memory_proposals_run ON memory_proposals(run_id, created_at_ms DESC, id);
CREATE TABLE viper_engine.memory_proposal_changes (
  proposal_id TEXT NOT NULL, actor_id TEXT NOT NULL, app_id TEXT NOT NULL, tenant_key TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1), status TEXT NOT NULL CHECK (status IN ('pending','accepted','rejected','stale')),
  note_id TEXT, created_at_ms INTEGER NOT NULL, PRIMARY KEY (proposal_id, revision),
  FOREIGN KEY (proposal_id, actor_id, app_id, tenant_key) REFERENCES memory_proposals(id, actor_id, app_id, tenant_key)
) STRICT;
`;
