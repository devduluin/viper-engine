const CONFIRMED_EVIDENCE = `EXISTS (
  SELECT 1 FROM learning_eligible e JOIN outcome_feedback f ON f.run_id = e.run_id
  WHERE e.run_id = NEW.run_id AND e.final_message_id = NEW.final_message_id AND f.verdict = 'confirmed'
    AND f.revision = NEW.feedback_revision AND f.revision = (SELECT max(revision) FROM outcome_feedback WHERE run_id = NEW.run_id)
)`;

export const LEARNING_GUARDS = `
CREATE TRIGGER viper_engine.feedback_guard BEFORE INSERT ON outcome_feedback
WHEN NEW.revision > 128 OR NEW.revision <> coalesce((SELECT max(revision) FROM outcome_feedback WHERE run_id = NEW.run_id), 0) + 1
  OR NOT EXISTS (SELECT 1 FROM runs r JOIN learning_user_statements m ON m.id = NEW.source_message_id
    WHERE r.id = NEW.run_id AND r.status IN ('completed','partial','failed','cancelled') AND m.conversation_id = r.conversation_id
      AND m.position > (SELECT max(position) FROM messages WHERE run_id = r.id)
      AND length(trim(m.statement)) > 0 AND length(CAST(m.statement AS BLOB)) <= 8192)
BEGIN SELECT RAISE(ABORT, 'feedback requires terminal run and fresh user evidence'); END;
CREATE TRIGGER viper_engine.feedback_no_update BEFORE UPDATE ON outcome_feedback
BEGIN SELECT RAISE(ABORT, 'feedback is immutable'); END;
CREATE TRIGGER viper_engine.feedback_no_delete BEFORE DELETE ON outcome_feedback
BEGIN SELECT RAISE(ABORT, 'feedback is immutable'); END;
CREATE TRIGGER viper_engine.proposal_start BEFORE INSERT ON memory_proposals
WHEN NEW.status <> 'pending' OR NEW.revision <> 1 OR NEW.note_id IS NOT NULL
  OR (SELECT count(*) FROM memory_proposals WHERE run_id = NEW.run_id) >= 32 OR NOT ${CONFIRMED_EVIDENCE}
BEGIN SELECT RAISE(ABORT, 'proposal requires confirmed outcome evidence'); END;
CREATE TRIGGER viper_engine.proposal_change BEFORE UPDATE ON memory_proposals
WHEN NEW.revision <> OLD.revision + 1
  OR NOT ((OLD.status = 'pending' AND NEW.status IN ('accepted','rejected','stale'))
    OR (OLD.status = 'accepted' AND NEW.status = 'stale'))
  OR (NEW.id, NEW.actor_id, NEW.app_id, NEW.tenant_key, NEW.run_id, NEW.conversation_id, NEW.feedback_revision,
    NEW.final_message_id, NEW.final_role, NEW.candidate_text, NEW.proposal_digest, NEW.evidence_digest, NEW.created_at_ms, NEW.confirmation_role)
  IS NOT (OLD.id, OLD.actor_id, OLD.app_id, OLD.tenant_key, OLD.run_id, OLD.conversation_id, OLD.feedback_revision,
    OLD.final_message_id, OLD.final_role, OLD.candidate_text, OLD.proposal_digest, OLD.evidence_digest, OLD.created_at_ms, OLD.confirmation_role)
  OR (NEW.status <> 'accepted' AND (NEW.note_id, NEW.note_revision, NEW.confirmation_message_id)
    IS NOT (OLD.note_id, OLD.note_revision, OLD.confirmation_message_id))
BEGIN SELECT RAISE(ABORT, 'invalid proposal mutation'); END;
CREATE TRIGGER viper_engine.proposal_accept BEFORE UPDATE ON memory_proposals
WHEN NEW.status = 'accepted' AND (NOT ${CONFIRMED_EVIDENCE} OR NOT EXISTS (
  SELECT 1 FROM learning_user_statements m JOIN memory_notes n ON n.id = NEW.note_id
  WHERE m.id = NEW.confirmation_message_id AND m.conversation_id = NEW.conversation_id AND m.statement = NEW.candidate_text
  AND m.position > (SELECT max(position) FROM messages WHERE run_id = NEW.run_id)
  AND n.status = 'active' AND n.revision = NEW.note_revision AND n.revision = 1 AND n.source_message_id = m.id
))
BEGIN SELECT RAISE(ABORT, 'proposal requires exact user confirmation'); END;
CREATE TRIGGER viper_engine.proposal_no_delete BEFORE DELETE ON memory_proposals
BEGIN SELECT RAISE(ABORT, 'proposal cannot be deleted'); END;
CREATE TRIGGER viper_engine.proposal_audit_insert AFTER INSERT ON memory_proposals
BEGIN INSERT INTO memory_proposal_changes VALUES (NEW.id, NEW.actor_id, NEW.app_id, NEW.tenant_key,
  NEW.revision, NEW.status, NEW.note_id, NEW.updated_at_ms); END;
CREATE TRIGGER viper_engine.proposal_audit_update AFTER UPDATE ON memory_proposals
BEGIN INSERT INTO memory_proposal_changes VALUES (NEW.id, NEW.actor_id, NEW.app_id, NEW.tenant_key,
  NEW.revision, NEW.status, NEW.note_id, NEW.updated_at_ms); END;
CREATE TRIGGER viper_engine.proposal_audit_no_update BEFORE UPDATE ON memory_proposal_changes
BEGIN SELECT RAISE(ABORT, 'proposal audit is immutable'); END;
CREATE TRIGGER viper_engine.proposal_audit_no_delete BEFORE DELETE ON memory_proposal_changes
BEGIN SELECT RAISE(ABORT, 'proposal audit is immutable'); END;
CREATE TRIGGER viper_engine.proposal_retire_note AFTER UPDATE ON memory_proposals WHEN OLD.status = 'accepted'
BEGIN UPDATE memory_notes SET status = 'deleted', source_message_id = NULL, source_conversation_id = NULL,
  revision = revision + 1, updated_at_ms = NEW.updated_at_ms WHERE id = OLD.note_id AND status = 'active'
  AND revision = OLD.note_revision AND source_message_id = OLD.confirmation_message_id; END;
CREATE TRIGGER viper_engine.feedback_invalidate AFTER INSERT ON outcome_feedback
BEGIN UPDATE memory_proposals SET status = 'stale', revision = revision + 1, updated_at_ms = NEW.created_at_ms
  WHERE run_id = NEW.run_id AND status IN ('pending','accepted') AND feedback_revision < NEW.revision; END;
`;
