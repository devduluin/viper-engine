export const RECALL_SCHEMA = `
CREATE UNIQUE INDEX viper_engine.messages_note_source_key
  ON messages(id, conversation_id, actor_id, app_id, tenant_key, role);
CREATE INDEX viper_engine.messages_owner_recent ON messages(actor_id, app_id, tenant_key, created_at_ms DESC, id);
CREATE TABLE viper_engine.memory_notes (
  id TEXT PRIMARY KEY NOT NULL, actor_id TEXT NOT NULL, app_id TEXT NOT NULL, tenant_key TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','deleted')),
  source_message_id TEXT, source_conversation_id TEXT, source_role TEXT NOT NULL DEFAULT 'user' CHECK (source_role = 'user'),
  created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
  UNIQUE (id, actor_id, app_id, tenant_key),
  CHECK ((status = 'active' AND source_message_id IS NOT NULL AND source_conversation_id IS NOT NULL)
    OR (status = 'deleted' AND source_message_id IS NULL AND source_conversation_id IS NULL)),
  FOREIGN KEY (source_message_id, source_conversation_id, actor_id, app_id, tenant_key, source_role)
    REFERENCES messages(id, conversation_id, actor_id, app_id, tenant_key, role)
) STRICT;
CREATE INDEX viper_engine.memory_notes_owner_recent
  ON memory_notes(actor_id, app_id, tenant_key, updated_at_ms DESC, id) WHERE status = 'active';
CREATE TABLE viper_engine.memory_note_changes (
  note_id TEXT NOT NULL, actor_id TEXT NOT NULL, app_id TEXT NOT NULL, tenant_key TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1), action TEXT NOT NULL CHECK (action IN ('created','corrected','deleted')),
  source_message_id TEXT, source_conversation_id TEXT, source_role TEXT NOT NULL DEFAULT 'user' CHECK (source_role = 'user'),
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (note_id, revision),
  CHECK ((action = 'deleted' AND source_message_id IS NULL AND source_conversation_id IS NULL)
    OR (action <> 'deleted' AND source_message_id IS NOT NULL AND source_conversation_id IS NOT NULL)),
  FOREIGN KEY (note_id, actor_id, app_id, tenant_key) REFERENCES memory_notes(id, actor_id, app_id, tenant_key),
  FOREIGN KEY (source_message_id, source_conversation_id, actor_id, app_id, tenant_key, source_role)
    REFERENCES messages(id, conversation_id, actor_id, app_id, tenant_key, role)
) STRICT;
CREATE TRIGGER viper_engine.memory_notes_initial BEFORE INSERT ON memory_notes WHEN NEW.revision <> 1
BEGIN SELECT RAISE(ABORT, 'initial note revision must be 1'); END;
CREATE TRIGGER viper_engine.memory_notes_guard BEFORE UPDATE ON memory_notes
WHEN OLD.status = 'deleted' OR NEW.revision <> OLD.revision + 1
  OR (NEW.id, NEW.actor_id, NEW.app_id, NEW.tenant_key, NEW.created_at_ms)
  IS NOT (OLD.id, OLD.actor_id, OLD.app_id, OLD.tenant_key, OLD.created_at_ms)
BEGIN SELECT RAISE(ABORT, 'invalid note mutation'); END;
CREATE TRIGGER viper_engine.memory_changes_no_update BEFORE UPDATE ON memory_note_changes
BEGIN SELECT RAISE(ABORT, 'note audit is immutable'); END;
CREATE TRIGGER viper_engine.memory_changes_no_delete BEFORE DELETE ON memory_note_changes
BEGIN SELECT RAISE(ABORT, 'note audit is immutable'); END;
CREATE TRIGGER viper_engine.memory_note_created AFTER INSERT ON memory_notes
BEGIN
  INSERT INTO memory_note_changes (note_id, actor_id, app_id, tenant_key, revision, action, source_message_id,
    source_conversation_id, created_at_ms)
  VALUES (NEW.id, NEW.actor_id, NEW.app_id, NEW.tenant_key, NEW.revision, 'created', NEW.source_message_id,
    NEW.source_conversation_id, NEW.updated_at_ms);
END;
CREATE TRIGGER viper_engine.memory_note_changed AFTER UPDATE ON memory_notes
BEGIN
  INSERT INTO memory_note_changes (note_id, actor_id, app_id, tenant_key, revision, action, source_message_id,
    source_conversation_id, created_at_ms)
  VALUES (NEW.id, NEW.actor_id, NEW.app_id, NEW.tenant_key, NEW.revision,
    CASE WHEN NEW.status = 'deleted' THEN 'deleted' ELSE 'corrected' END, NEW.source_message_id,
    NEW.source_conversation_id, NEW.updated_at_ms);
END;
`;
