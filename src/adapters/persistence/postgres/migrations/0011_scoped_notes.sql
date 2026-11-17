-- Explicitly selected user statements; no generated answers promoted to facts, no text copies.
ALTER TABLE viper_engine.messages ADD CONSTRAINT messages_note_source_key
  UNIQUE (id, conversation_id, actor_id, app_id, tenant_key, role);

CREATE TABLE viper_engine.memory_notes (
  id viper_engine.entity_id PRIMARY KEY,
  actor_id viper_engine.entity_id NOT NULL,
  app_id viper_engine.entity_id NOT NULL,
  tenant_key viper_engine.tenant_key,
  revision viper_engine.revision DEFAULT 1,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  source_message_id viper_engine.entity_id,
  source_conversation_id viper_engine.entity_id,
  source_role text NOT NULL DEFAULT 'user' CHECK (source_role = 'user'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (id, actor_id, app_id, tenant_key),
  CHECK ((status = 'active' AND source_message_id IS NOT NULL AND source_conversation_id IS NOT NULL)
    OR (status = 'deleted' AND source_message_id IS NULL AND source_conversation_id IS NULL)),
  FOREIGN KEY (source_message_id, source_conversation_id, actor_id, app_id, tenant_key, source_role)
    REFERENCES viper_engine.messages (id, conversation_id, actor_id, app_id, tenant_key, role)
);
CREATE INDEX memory_notes_owner_recent ON viper_engine.memory_notes
  (actor_id, app_id, tenant_key, updated_at DESC, id) WHERE status = 'active';
CREATE INDEX messages_owner_recent ON viper_engine.messages (actor_id, app_id, tenant_key, created_at DESC, id);

CREATE TABLE viper_engine.memory_note_changes (
  note_id viper_engine.entity_id NOT NULL,
  actor_id viper_engine.entity_id NOT NULL,
  app_id viper_engine.entity_id NOT NULL,
  tenant_key viper_engine.tenant_key,
  revision viper_engine.revision,
  action text NOT NULL CHECK (action IN ('created', 'corrected', 'deleted')),
  source_message_id viper_engine.entity_id,
  source_conversation_id viper_engine.entity_id,
  source_role text NOT NULL DEFAULT 'user' CHECK (source_role = 'user'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (note_id, revision),
  CHECK ((action = 'deleted' AND source_message_id IS NULL AND source_conversation_id IS NULL)
    OR (action <> 'deleted' AND source_message_id IS NOT NULL AND source_conversation_id IS NOT NULL)),
  FOREIGN KEY (note_id, actor_id, app_id, tenant_key)
    REFERENCES viper_engine.memory_notes (id, actor_id, app_id, tenant_key),
  FOREIGN KEY (source_message_id, source_conversation_id, actor_id, app_id, tenant_key, source_role)
    REFERENCES viper_engine.messages (id, conversation_id, actor_id, app_id, tenant_key, role)
);

CREATE FUNCTION viper_engine.guard_note_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'deleted' OR NEW.id <> OLD.id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'Note identity and deleted tombstone are immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER revision_step BEFORE UPDATE ON viper_engine.memory_notes
  FOR EACH ROW EXECUTE FUNCTION viper_engine.enforce_revision_step();
CREATE TRIGGER owner_fixed BEFORE UPDATE ON viper_engine.memory_notes
  FOR EACH ROW EXECUTE FUNCTION viper_engine.reject_owner_change();
CREATE TRIGGER note_fixed BEFORE UPDATE ON viper_engine.memory_notes
  FOR EACH ROW EXECUTE FUNCTION viper_engine.guard_note_update();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON viper_engine.memory_note_changes
  FOR EACH ROW EXECUTE FUNCTION viper_engine.reject_update();

CREATE FUNCTION viper_engine.audit_note_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.revision <> 1 THEN
    RAISE EXCEPTION 'Initial note revision must be 1' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO viper_engine.memory_note_changes
    (note_id, actor_id, app_id, tenant_key, revision, action, source_message_id, source_conversation_id, created_at)
  VALUES (NEW.id, NEW.actor_id, NEW.app_id, NEW.tenant_key, NEW.revision,
    CASE WHEN TG_OP = 'INSERT' THEN 'created' WHEN NEW.status = 'deleted' THEN 'deleted' ELSE 'corrected' END,
    NEW.source_message_id, NEW.source_conversation_id, NEW.updated_at);
  RETURN NEW;
END $$;
CREATE TRIGGER note_audit AFTER INSERT OR UPDATE ON viper_engine.memory_notes
  FOR EACH ROW EXECUTE FUNCTION viper_engine.audit_note_change();
