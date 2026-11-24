-- Sub-agent settlement (PLAN-SUBAGENTS P0). Enforced in the database so no code path can miss it: a child that
-- becomes terminal satisfies the awaits links pointing at it, and a parent parked in waiting_for_agents is woken
-- (status running, lease cleared, fence advanced, exactly like RunStore.wake) once none of its awaits is open.
-- A parent that becomes terminal requests cancellation of its live children (idempotent, like requestCancellation).
CREATE FUNCTION viper_engine.settle_agent_runs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status NOT IN ('completed', 'partial', 'failed', 'cancelled') OR OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  UPDATE viper_engine.run_links SET satisfied_at = NEW.updated_at
    WHERE to_run_id = NEW.id AND kind = 'awaits' AND satisfied_at IS NULL;
  UPDATE viper_engine.runs AS p SET status = 'running', revision = p.revision + 1, updated_at = NEW.updated_at,
      lease_owner = NULL, lease_expires_at = NULL, lease_fence = p.lease_fence + 1
    WHERE p.id = NEW.parent_run_id AND p.status = 'waiting_for_agents'
      AND NOT EXISTS (SELECT 1 FROM viper_engine.run_links l
        WHERE l.from_run_id = p.id AND l.kind = 'awaits' AND l.satisfied_at IS NULL);
  UPDATE viper_engine.runs AS c SET cancel_requested_at = NEW.updated_at, revision = c.revision + 1, updated_at = NEW.updated_at
    WHERE c.parent_run_id = NEW.id AND c.cancel_requested_at IS NULL
      AND c.status NOT IN ('completed', 'partial', 'failed', 'cancelled');
  RETURN NEW;
END $$;
CREATE TRIGGER settle_agent_runs AFTER UPDATE OF status ON viper_engine.runs
  FOR EACH ROW EXECUTE FUNCTION viper_engine.settle_agent_runs();
