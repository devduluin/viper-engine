-- Explicit feedback and reviewable candidates. No executable memory or generated facts.
CREATE TABLE viper_engine.outcome_feedback (
  run_id viper_engine.entity_id NOT NULL,
  revision viper_engine.revision,
  actor_id viper_engine.entity_id NOT NULL,
  app_id viper_engine.entity_id NOT NULL,
  tenant_key viper_engine.tenant_key,
  conversation_id viper_engine.entity_id NOT NULL,
  source_message_id viper_engine.entity_id NOT NULL,
  source_role text NOT NULL DEFAULT 'user' CHECK (source_role = 'user'),
  verdict text NOT NULL CHECK (verdict IN ('confirmed', 'disputed')),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (run_id, revision),
  UNIQUE (run_id, revision, actor_id, app_id, tenant_key),
  FOREIGN KEY (run_id, conversation_id, actor_id, app_id, tenant_key)
    REFERENCES viper_engine.runs (id, conversation_id, actor_id, app_id, tenant_key),
  FOREIGN KEY (source_message_id, conversation_id, actor_id, app_id, tenant_key, source_role)
    REFERENCES viper_engine.messages (id, conversation_id, actor_id, app_id, tenant_key, role)
);
CREATE TABLE viper_engine.memory_proposals (
  id viper_engine.entity_id PRIMARY KEY,
  actor_id viper_engine.entity_id NOT NULL,
  app_id viper_engine.entity_id NOT NULL,
  tenant_key viper_engine.tenant_key,
  run_id viper_engine.entity_id NOT NULL,
  conversation_id viper_engine.entity_id NOT NULL,
  feedback_revision viper_engine.revision,
  final_message_id viper_engine.entity_id NOT NULL,
  final_role text NOT NULL DEFAULT 'assistant' CHECK (final_role = 'assistant'),
  candidate_text text NOT NULL CHECK (length(btrim(candidate_text)) > 0 AND octet_length(candidate_text) <= 8192),
  proposal_digest viper_engine.sha256_hex NOT NULL,
  evidence_digest viper_engine.sha256_hex NOT NULL,
  revision viper_engine.revision DEFAULT 1,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'stale')),
  note_id viper_engine.entity_id UNIQUE,
  note_revision bigint CHECK (note_revision >= 1),
  confirmation_message_id viper_engine.entity_id,
  confirmation_role text NOT NULL DEFAULT 'user' CHECK (confirmation_role = 'user'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (id, actor_id, app_id, tenant_key),
  UNIQUE (actor_id, app_id, tenant_key, proposal_digest),
  CHECK (num_nonnulls(note_id, note_revision, confirmation_message_id) IN (0, 3)),
  CHECK (status <> 'accepted' OR note_id IS NOT NULL),
  FOREIGN KEY (run_id, conversation_id, actor_id, app_id, tenant_key)
    REFERENCES viper_engine.runs (id, conversation_id, actor_id, app_id, tenant_key),
  FOREIGN KEY (run_id, feedback_revision, actor_id, app_id, tenant_key)
    REFERENCES viper_engine.outcome_feedback (run_id, revision, actor_id, app_id, tenant_key),
  FOREIGN KEY (final_message_id, conversation_id, actor_id, app_id, tenant_key, final_role)
    REFERENCES viper_engine.messages (id, conversation_id, actor_id, app_id, tenant_key, role),
  FOREIGN KEY (confirmation_message_id, conversation_id, actor_id, app_id, tenant_key, confirmation_role)
    REFERENCES viper_engine.messages (id, conversation_id, actor_id, app_id, tenant_key, role),
  FOREIGN KEY (note_id, actor_id, app_id, tenant_key)
    REFERENCES viper_engine.memory_notes (id, actor_id, app_id, tenant_key)
);
CREATE INDEX memory_proposals_run ON viper_engine.memory_proposals (run_id, created_at DESC, id);
CREATE TABLE viper_engine.memory_proposal_changes (
  proposal_id viper_engine.entity_id NOT NULL,
  actor_id viper_engine.entity_id NOT NULL,
  app_id viper_engine.entity_id NOT NULL,
  tenant_key viper_engine.tenant_key,
  revision viper_engine.revision,
  status text NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'stale')),
  note_id viper_engine.entity_id,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (proposal_id, revision),
  FOREIGN KEY (proposal_id, actor_id, app_id, tenant_key)
    REFERENCES viper_engine.memory_proposals (id, actor_id, app_id, tenant_key)
);

-- Source must be an owned, text-only user statement added after the run's history.
CREATE FUNCTION viper_engine.learning_user_text(message_id text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT string_agg(b.block->>'text', E'\n' ORDER BY b.ord) FROM viper_engine.messages m,
    LATERAL jsonb_array_elements(m.content) WITH ORDINALITY b(block, ord)
  WHERE m.id = message_id AND m.role = 'user'
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(m.content) c WHERE c->>'type' IS DISTINCT FROM 'text')
$$;
CREATE FUNCTION viper_engine.learning_source_after(run_key text, message_key text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM viper_engine.runs r JOIN viper_engine.messages m
    ON m.conversation_id = r.conversation_id AND m.actor_id = r.actor_id AND m.app_id = r.app_id AND m.tenant_key = r.tenant_key
    WHERE r.id = run_key AND m.id = message_key AND m.role = 'user'
    AND m.position > (SELECT max(position) FROM viper_engine.messages WHERE run_id = r.id)
    AND length(btrim(viper_engine.learning_user_text(m.id))) > 0
    AND octet_length(viper_engine.learning_user_text(m.id)) <= 8192)
$$;
CREATE FUNCTION viper_engine.learning_eligible(run_key text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM viper_engine.runs r JOIN viper_engine.runtime_checkpoints c ON c.run_id = r.id
    WHERE r.id = run_key AND r.status = 'completed' AND c.state->>'version' = '1' AND c.state->>'phase' = 'final'
    AND c.state->>'modelPending' = 'false'
    AND (SELECT count(*) FROM viper_engine.model_calls WHERE run_id = r.id) BETWEEN 1 AND 1000
    AND NOT EXISTS (SELECT 1 FROM viper_engine.model_calls WHERE run_id = r.id AND (outcome <> 'succeeded' OR ended_at IS NULL))
    AND (SELECT count(*) FROM viper_engine.tool_calls WHERE run_id = r.id) <= 1000
    AND (SELECT count(*) FROM viper_engine.tool_call_attempts WHERE run_id = r.id) <= 2000
    AND NOT EXISTS (SELECT 1 FROM viper_engine.tool_calls WHERE run_id = r.id AND status <> 'succeeded')
    AND NOT EXISTS (SELECT 1 FROM viper_engine.tool_calls t WHERE t.run_id = r.id AND
      (t.attempts <> (SELECT count(*) FROM viper_engine.tool_call_attempts WHERE run_id = t.run_id AND tool_call_id = t.id)
      OR t.attempts <> (SELECT coalesce(max(attempt), 0) FROM viper_engine.tool_call_attempts WHERE run_id = t.run_id AND tool_call_id = t.id)))
    AND NOT EXISTS (SELECT 1 FROM viper_engine.tool_call_attempts WHERE run_id = r.id AND result_kind IS DISTINCT FROM 'succeeded')
    AND EXISTS (SELECT 1 FROM viper_engine.messages m WHERE m.run_id = r.id AND m.role = 'assistant'
      AND m.tool_calls IS NULL AND jsonb_array_length(m.content) > 0
      AND m.position = (SELECT max(position) FROM viper_engine.messages WHERE run_id = r.id)))
$$;
CREATE FUNCTION viper_engine.guard_outcome_feedback() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous bigint; run_status text;
BEGIN
  SELECT status INTO run_status FROM viper_engine.runs WHERE id = NEW.run_id FOR UPDATE;
  SELECT coalesce(max(revision), 0) INTO previous FROM viper_engine.outcome_feedback WHERE run_id = NEW.run_id;
  IF run_status NOT IN ('completed', 'partial', 'failed', 'cancelled') OR previous >= 128
    OR NEW.revision <> previous + 1 OR NOT viper_engine.learning_source_after(NEW.run_id, NEW.source_message_id) THEN
    RAISE EXCEPTION 'Feedback requires terminal run and new user evidence; bounded gap-free revisions' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER feedback_guard BEFORE INSERT ON viper_engine.outcome_feedback
  FOR EACH ROW EXECUTE FUNCTION viper_engine.guard_outcome_feedback();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON viper_engine.outcome_feedback
  FOR EACH ROW EXECUTE FUNCTION viper_engine.reject_update();

CREATE FUNCTION viper_engine.guard_proposal_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.actor_id, NEW.app_id, NEW.tenant_key, NEW.run_id, NEW.conversation_id,
    NEW.feedback_revision, NEW.final_message_id, NEW.final_role, NEW.candidate_text, NEW.proposal_digest,
    NEW.evidence_digest, NEW.created_at, NEW.confirmation_role)
    IS DISTINCT FROM (OLD.id, OLD.actor_id, OLD.app_id, OLD.tenant_key, OLD.run_id, OLD.conversation_id,
    OLD.feedback_revision, OLD.final_message_id, OLD.final_role, OLD.candidate_text, OLD.proposal_digest,
    OLD.evidence_digest, OLD.created_at, OLD.confirmation_role) THEN
    RAISE EXCEPTION 'Proposal source, candidate and identity are immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT ((OLD.status = 'pending' AND NEW.status IN ('accepted', 'rejected', 'stale'))
    OR (OLD.status = 'accepted' AND NEW.status = 'stale')) THEN
    RAISE EXCEPTION 'Invalid proposal transition' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> 'accepted' AND (NEW.note_id, NEW.note_revision, NEW.confirmation_message_id)
    IS DISTINCT FROM (OLD.note_id, OLD.note_revision, OLD.confirmation_message_id) THEN
    RAISE EXCEPTION 'Confirmation binding is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'accepted' THEN
    UPDATE viper_engine.memory_notes SET status = 'deleted', source_message_id = NULL, source_conversation_id = NULL,
      revision = revision + 1, updated_at = NEW.updated_at WHERE id = OLD.note_id AND status = 'active'
      AND revision = OLD.note_revision AND source_message_id = OLD.confirmation_message_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER proposal_identity BEFORE UPDATE ON viper_engine.memory_proposals
  FOR EACH ROW EXECUTE FUNCTION viper_engine.guard_proposal_identity();
CREATE TRIGGER revision_step BEFORE UPDATE ON viper_engine.memory_proposals
  FOR EACH ROW EXECUTE FUNCTION viper_engine.enforce_revision_step();

CREATE FUNCTION viper_engine.guard_proposal_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE latest viper_engine.outcome_feedback%ROWTYPE;
BEGIN
  PERFORM 1 FROM viper_engine.runs WHERE id = NEW.run_id FOR UPDATE;
  SELECT * INTO latest FROM viper_engine.outcome_feedback WHERE run_id = NEW.run_id ORDER BY revision DESC LIMIT 1;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' OR NEW.revision <> 1 OR NEW.note_id IS NOT NULL
      OR (SELECT count(*) FROM viper_engine.memory_proposals WHERE run_id = NEW.run_id) >= 32 THEN
      RAISE EXCEPTION 'Proposal must start pending and within run limit' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.status = 'accepted' THEN
    IF latest.revision IS DISTINCT FROM NEW.feedback_revision OR latest.verdict IS DISTINCT FROM 'confirmed'
      OR NOT viper_engine.learning_eligible(NEW.run_id)
      OR NEW.final_message_id IS DISTINCT FROM (SELECT id FROM viper_engine.messages WHERE run_id = NEW.run_id ORDER BY position DESC LIMIT 1) THEN
      RAISE EXCEPTION 'Current confirmed outcome evidence required' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.status = 'accepted' THEN
    IF NOT viper_engine.learning_source_after(NEW.run_id, NEW.confirmation_message_id)
      OR viper_engine.learning_user_text(NEW.confirmation_message_id) IS DISTINCT FROM NEW.candidate_text
      OR NOT EXISTS (SELECT 1 FROM viper_engine.memory_notes n WHERE n.id = NEW.note_id AND n.status = 'active'
        AND n.revision = NEW.note_revision AND n.revision = 1 AND n.source_message_id = NEW.confirmation_message_id) THEN
      RAISE EXCEPTION 'Explicit exact user confirmation and matching note required' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER proposal_evidence BEFORE INSERT OR UPDATE ON viper_engine.memory_proposals
  FOR EACH ROW EXECUTE FUNCTION viper_engine.guard_proposal_evidence();
CREATE TRIGGER no_delete BEFORE DELETE ON viper_engine.memory_proposals
  FOR EACH ROW EXECUTE FUNCTION viper_engine.reject_update();

CREATE FUNCTION viper_engine.audit_proposal_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO viper_engine.memory_proposal_changes (proposal_id, actor_id, app_id, tenant_key, revision, status, note_id, created_at)
    VALUES (NEW.id, NEW.actor_id, NEW.app_id, NEW.tenant_key, NEW.revision, NEW.status, NEW.note_id, NEW.updated_at);
  RETURN NEW;
END $$;
CREATE TRIGGER proposal_audit AFTER INSERT OR UPDATE ON viper_engine.memory_proposals
  FOR EACH ROW EXECUTE FUNCTION viper_engine.audit_proposal_change();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON viper_engine.memory_proposal_changes
  FOR EACH ROW EXECUTE FUNCTION viper_engine.reject_update();
CREATE FUNCTION viper_engine.invalidate_learning() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE proposal viper_engine.memory_proposals%ROWTYPE;
BEGIN
  FOR proposal IN SELECT * FROM viper_engine.memory_proposals WHERE run_id = NEW.run_id
    AND status IN ('pending', 'accepted') AND feedback_revision < NEW.revision ORDER BY id FOR UPDATE LOOP
    UPDATE viper_engine.memory_proposals SET status = 'stale', revision = revision + 1, updated_at = NEW.created_at WHERE id = proposal.id;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER feedback_invalidate AFTER INSERT ON viper_engine.outcome_feedback
  FOR EACH ROW EXECUTE FUNCTION viper_engine.invalidate_learning();
