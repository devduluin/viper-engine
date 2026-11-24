-- Two children settling at the same moment could both miss the wake: each transaction saw the other's awaits link
-- still open (uncommitted), so neither woke the parked parent. Settlement now locks the parent row first, which
-- serializes the children of one parent; in READ COMMITTED each later statement sees the earlier child's commit.
-- (SQLite has a single writer and needs no change.)
CREATE OR REPLACE FUNCTION viper_engine.settle_agent_runs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status NOT IN ('completed', 'partial', 'failed', 'cancelled') OR OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  IF NEW.parent_run_id IS NOT NULL THEN
    PERFORM 1 FROM viper_engine.runs WHERE id = NEW.parent_run_id FOR UPDATE;
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
