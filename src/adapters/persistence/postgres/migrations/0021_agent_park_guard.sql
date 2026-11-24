-- Closes the park race (PLAN-SUBAGENTS §4): a child may settle between the parent's last check and its commit to
-- waiting_for_agents. The settlement trigger then saw a running parent and woke nobody, so the parent would park
-- with nothing left to wait for. A parent that parks with no open awaits is woken at once (lease cleared, fence
-- advanced); a worker picks it up and it reads the results. Row locks order the two transactions either way.
CREATE FUNCTION viper_engine.wake_settled_parent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'waiting_for_agents' AND OLD.status <> NEW.status AND NOT EXISTS (
    SELECT 1 FROM viper_engine.run_links l WHERE l.from_run_id = NEW.id AND l.kind = 'awaits' AND l.satisfied_at IS NULL) THEN
    UPDATE viper_engine.runs SET status = 'running', revision = revision + 1, updated_at = NEW.updated_at,
      lease_owner = NULL, lease_expires_at = NULL, lease_fence = lease_fence + 1
    WHERE id = NEW.id AND status = 'waiting_for_agents';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wake_settled_parent AFTER UPDATE OF status ON viper_engine.runs
  FOR EACH ROW EXECUTE FUNCTION viper_engine.wake_settled_parent();
